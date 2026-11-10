import { TRACING_SCENARIOS } from '@lobechat/const';
import type { TracingOptions } from '@lobechat/llm-generation-tracing';
import {
  chainMeetingMinutes,
  MEETING_MINUTES_JSON_SCHEMA,
  MEETING_MINUTES_PROMPT_VERSION,
} from '@lobechat/prompts';
import type {
  MeetingActionItem,
  MeetingAssignee,
  MeetingError,
  UserSystemAgentConfig,
} from '@lobechat/types';
import { RequestTrigger } from '@lobechat/types';
import dayjs from 'dayjs';
import debug from 'debug';

import { AgentModel } from '@/database/models/agent';
import { MeetingModel } from '@/database/models/meeting';
import { NotificationModel } from '@/database/models/notification';
import { UserModel } from '@/database/models/user';
import { WorkspaceMemberModel } from '@/database/models/workspaceMember';
import type { LobeChatDatabase } from '@/database/type';
import { AiGenerationService } from '@/server/services/aiGeneration';
import { TaskService } from '@/server/services/task';
import { notifyAssignedBestEffort } from '@/server/services/task/assignmentNotification';

import { resolveSystemAgentModelConfig } from '../../systemAgent/modelConfig';
import { MeetingTranscriptionError, toMeetingErrorCode, toMeetingErrorMessage } from '../errors';
import { type AssigneeCandidate, matchAssignee } from './assignee';
import { generatedMinutesSchema, type MinutesTranscriptLine, normalizeMinutes } from './normalize';
import { buildTaskInstruction } from './taskInstruction';

const log = debug('lobe-server:meeting-minutes');

/** Transcript characters sent to the model; a two-hour meeting fits well below it. */
const MAX_TRANSCRIPT_CHARS = 200_000;
/** Members and agents offered as assignees, both to the model and to the picker. */
const MAX_ASSIGNEE_CANDIDATES = 200;
/** Longest task name; the full item text also goes into the instruction. */
const MAX_TASK_NAME = 120;

export interface CreateTasksItemInput {
  assignee?: Pick<MeetingAssignee, 'id' | 'type'> | null;
  dueDate?: string | null;
  id: string;
  text: string;
}

export interface CreateTasksResult {
  created: { itemId: string; taskId: string; taskIdentifier: string }[];
  failed: { itemId: string; message: string }[];
}

const isoDay = (date: Date) => dayjs(date).format('YYYY-MM-DD (dddd)');

/**
 * Minutes of a meeting and the tasks that come out of them.
 *
 * - `generate` writes the minutes (summary, chapters, decisions, action items
 *   with owner, deadline and the transcript passage they come from) from the
 *   final transcript, matches owners to workspace members or agents, and —
 *   when the user turned it on — creates the tasks straight away.
 * - `createTasks` turns confirmed action items into LobeHub tasks, links each
 *   task back into the minutes, and notifies the recorder and the assignees.
 */
export class MeetingMinutesService {
  private readonly meetingModel: MeetingModel;

  constructor(
    private readonly db: LobeChatDatabase,
    private readonly userId: string,
    private readonly workspaceId?: string,
  ) {
    this.meetingModel = new MeetingModel(db, userId, workspaceId);
  }

  /**
   * Generate (or regenerate) the minutes. Returns the meeting afterwards —
   * `ready`, with `error.stage = 'minutes'` when generation failed — or
   * `undefined` when it is not the caller's. Throws `MeetingStateError` while
   * the transcript is not final yet.
   */
  async generate(meetingId: string) {
    const started = await this.meetingModel.startMinutes(meetingId);
    if (!started) return undefined;

    const startedAt = Date.now();
    try {
      const detail = await this.meetingModel.getDetail(meetingId);
      if (!detail) return undefined;

      const speakerNames = new Map(
        detail.speakers.map((speaker) => [speaker.id, speaker.displayName || speaker.label]),
      );
      const speakerLabels = new Map(detail.speakers.map((speaker) => [speaker.id, speaker.label]));
      const segments = detail.segments.filter((segment) => segment.text.trim());
      if (segments.length === 0) {
        throw new MeetingTranscriptionError('transcript_empty', 'The transcript has no speech');
      }

      const lines: MinutesTranscriptLine[] = [];
      const promptLines = [];
      let chars = 0;
      for (const segment of segments) {
        chars += segment.text.length;
        if (chars > MAX_TRANSCRIPT_CHARS) break;
        const speakerLabel = segment.speakerId ? speakerLabels.get(segment.speakerId) : undefined;
        lines.push({
          endMs: segment.endMs,
          segmentId: segment.id,
          speakerLabel,
          startMs: segment.startMs,
        });
        promptLines.push({
          index: promptLines.length,
          speaker: segment.speakerId ? speakerNames.get(segment.speakerId) : undefined,
          startMs: segment.startMs,
          text: segment.text.trim(),
        });
      }
      if (lines.length < segments.length) {
        log('minutes %s: transcript cut at %d/%d lines', meetingId, lines.length, segments.length);
      }

      const candidates = await this.listAssigneeCandidates();
      const recorder = candidates.find(
        (candidate) => candidate.type === 'user' && candidate.id === this.userId,
      );
      const { model, provider } = await this.resolveModel();

      const raw = await new AiGenerationService(
        this.db,
        this.userId,
        this.workspaceId,
      ).generateObject(
        {
          ...chainMeetingMinutes({
            assigneeNames: candidates.map((candidate) => candidate.name),
            language: detail.language,
            meetingDate: isoDay(detail.startedAt),
            recorderName: recorder?.name,
            title: detail.title,
            transcript: promptLines,
          }),
          model,
          provider,
          schema: MEETING_MINUTES_JSON_SCHEMA,
        },
        {
          metadata: { trigger: RequestTrigger.MeetingMinutes },
          tracing: {
            promptVersion: MEETING_MINUTES_PROMPT_VERSION,
            scenario: TRACING_SCENARIOS.MeetingMinutes,
            schemaName: MEETING_MINUTES_JSON_SCHEMA.name,
          } satisfies TracingOptions,
        },
      );

      const parsed = generatedMinutesSchema.safeParse(raw);
      if (!parsed.success) {
        log('minutes %s did not match schema: %O', meetingId, parsed.error.flatten());
        throw new MeetingTranscriptionError(
          'summarization_failed',
          'Generated minutes did not match the expected shape',
        );
      }

      // Speaker labels resolve through the names the user gave them ("Speaker 2" → "Alice").
      const labelNames = new Map(
        detail.speakers
          .filter((speaker) => speaker.displayName)
          .map((speaker) => [speaker.label, speaker.displayName!]),
      );
      const batch = Date.now().toString(36);
      const minutes = normalizeMinutes(parsed.data, lines, {
        actionItemId: (index) => `act_${batch}_${index}`,
        resolveAssignee: (hint) =>
          matchAssignee(hint, candidates, { recorder, speakerNames: labelNames }),
      });

      // Items already turned into tasks survive a regeneration, so their links never break,
      // and a new suggestion citing the same passage as one of them is the same to-do again.
      const kept = (detail.minutes?.actionItems ?? []).filter((item) => item.status === 'created');
      const takenSegments = new Set(kept.flatMap((item) => item.segmentIds));
      const fresh = minutes.actionItems.filter(
        (item) => !item.segmentIds.some((id) => takenSegments.has(id)),
      );
      const result = await this.meetingModel.completeMinutes(meetingId, {
        ...minutes,
        actionItems: [...kept, ...fresh],
        model: `${provider}/${model}`,
      });
      log('minutes %s: %d action items in %dms', meetingId, fresh.length, Date.now() - startedAt);

      const preference = await new UserModel(this.db, this.userId).getUserPreference();
      if (preference?.meeting?.autoCreateTasks && fresh.length > 0) {
        await this.createTasks(
          meetingId,
          fresh.map((item) => ({
            assignee: item.assignee,
            dueDate: item.dueDate,
            id: item.id,
            text: item.text,
          })),
        );
      }

      return result?.meeting;
    } catch (error) {
      const meetingError: MeetingError = {
        code:
          error instanceof MeetingTranscriptionError
            ? error.code
            : toMeetingErrorCode(error, 'summarization_failed'),
        message: toMeetingErrorMessage(error),
        stage: 'minutes',
      };
      console.error('[meeting:minutes] failed', meetingId, meetingError);
      return this.meetingModel.failMinutes(meetingId, meetingError);
    }
  }

  /**
   * Once a diarized speaker gets a name, give it the suggested to-dos the
   * minutes attributed to that speaker's label ("S3") and that nobody has
   * assigned yet, when the name matches one member or agent. Items the user
   * already assigned, created or dismissed are left alone.
   */
  async assignSpeakerItems(meetingId: string, label: string, displayName: string | null) {
    if (!displayName) return undefined;

    const candidates = await this.listAssigneeCandidates();
    const assignee = matchAssignee(displayName, candidates, { speakerNames: new Map() });
    if (!assignee) return undefined;

    return this.meetingModel.updateActionItems(meetingId, (items) =>
      items.map((item) =>
        item.status === 'suggested' && !item.assignee && item.assigneeHint?.trim() === label
          ? { ...item, assignee }
          : item,
      ),
    );
  }

  /**
   * Members and agents an action item can be assigned to: in a workspace its
   * members who may own tasks, otherwise the user alone; plus the agents the
   * caller can see.
   */
  async listAssigneeCandidates(): Promise<AssigneeCandidate[]> {
    const memberIds = this.workspaceId
      ? (
          await new WorkspaceMemberModel(this.db, this.userId).searchAssignableMembers(
            this.workspaceId,
            { limit: MAX_ASSIGNEE_CANDIDATES },
          )
        ).rows.map((row) => row.userId)
      : [this.userId];

    const [users, agents] = await Promise.all([
      UserModel.getDisplayInfoByIds(this.db, memberIds),
      new AgentModel(this.db, this.userId, this.workspaceId).queryAgents({
        includeInbox: true,
        limit: MAX_ASSIGNEE_CANDIDATES,
      }),
    ]);

    return [
      ...users.map((user): AssigneeCandidate => ({
        aliases: [user.username].filter((alias): alias is string => !!alias),
        avatar: user.avatar,
        id: user.id,
        name: user.fullName || user.username || user.id,
        type: 'user',
      })),
      ...agents
        .filter((agent) => agent.title || agent.name)
        .map((agent): AssigneeCandidate => ({
          aliases: [agent.name].filter((alias): alias is string => !!alias),
          avatar: agent.avatar,
          id: agent.id,
          name: (agent.title || agent.name)!,
          type: 'agent',
        })),
    ];
  }

  /**
   * Create one task per confirmed action item, with the text, owner and
   * deadline the user confirmed. Each created task is linked back into the
   * minutes (`status: 'created'`, `taskId`); an item that fails stays
   * `suggested` and is reported, so a retry only re-sends what is missing.
   * Items already turned into tasks are skipped, never duplicated.
   */
  async createTasks(meetingId: string, items: CreateTasksItemInput[]) {
    const detail = await this.meetingModel.getDetail(meetingId);
    if (!detail?.minutes) return undefined;

    const stored = new Map(detail.minutes.actionItems.map((item) => [item.id, item]));
    const candidates = await this.listAssigneeCandidates();
    const findCandidate = (assignee?: Pick<MeetingAssignee, 'id' | 'type'> | null) =>
      assignee
        ? candidates.find((c) => c.id === assignee.id && c.type === assignee.type)
        : undefined;

    const taskService = new TaskService(this.db, this.userId, this.workspaceId);
    const ctx = { userId: this.userId, workspaceId: this.workspaceId };
    const result: CreateTasksResult = { created: [], failed: [] };
    const updates = new Map<string, Partial<MeetingActionItem>>();

    for (const input of items) {
      const item = stored.get(input.id);
      if (!item || item.status === 'created') continue;

      const text = input.text.trim() || item.text;
      const candidate = findCandidate(input.assignee);
      if (input.assignee && !candidate) {
        result.failed.push({ itemId: item.id, message: 'Assignee is not available' });
        continue;
      }
      const dueDate = input.dueDate?.trim() || undefined;

      try {
        const task = await taskService.createTask({
          ...(candidate?.type === 'agent' && { assigneeAgentId: candidate.id }),
          ...(candidate?.type === 'user' && { assigneeUserId: candidate.id }),
          instruction: buildTaskInstruction({
            dueDate,
            meetingId,
            meetingTitle: detail.title,
            quote: item.segmentIds
              .map((id) => detail.segments.find((segment) => segment.id === id)?.text)
              .filter((quote): quote is string => !!quote),
            startMs: item.startMs,
            text,
          }),
          name: text.length > MAX_TASK_NAME ? `${text.slice(0, MAX_TASK_NAME - 1)}…` : text,
        });
        notifyAssignedBestEffort(ctx, task);

        result.created.push({ itemId: item.id, taskId: task.id, taskIdentifier: task.identifier });
        updates.set(item.id, {
          assignee: candidate
            ? { id: candidate.id, name: candidate.name, type: candidate.type }
            : undefined,
          dueDate,
          status: 'created',
          taskId: task.id,
          taskIdentifier: task.identifier,
          text,
        });
      } catch (error) {
        console.error('[meeting:createTasks] task not created', meetingId, item.id, error);
        result.failed.push({
          itemId: item.id,
          message: error instanceof Error ? error.message : 'Task could not be created',
        });
      }
    }

    const minutes =
      updates.size > 0
        ? await this.meetingModel.updateActionItems(meetingId, (current) =>
            current.map((item) => {
              const update = updates.get(item.id);
              // Another confirmation may have linked this item meanwhile; keep its task.
              return update && item.status !== 'created' ? { ...item, ...update } : item;
            }),
          )
        : detail.minutes;

    if (result.created.length > 0)
      await this.notifyTasksCreated(detail, result.created.length, updates);

    return { ...result, minutes };
  }

  /** Inbox entry for the recorder: which meeting produced how many tasks, linking back to it. */
  private async notifyTasksCreated(
    meeting: { id: string; title: string },
    count: number,
    updates: Map<string, Partial<MeetingActionItem>>,
  ) {
    const lines = [...updates.values()].map((update) => {
      const owner = update.assignee ? ` → ${update.assignee.name}` : '';
      const due = update.dueDate ? ` (due ${update.dueDate})` : '';
      return `- ${update.taskIdentifier} ${update.text}${owner}${due}`;
    });

    const title = `${count} ${count === 1 ? 'task' : 'tasks'} created from "${meeting.title}"`;
    try {
      await new NotificationModel(this.db, this.userId, {
        workspaceId: this.workspaceId ?? null,
      }).create({
        actionUrl: `/meeting/${meeting.id}`,
        category: 'meeting',
        // The inbox row previews the content, so it opens with the summary line too.
        content: [`${title}:`, ...lines].join('\n'),
        dedupeKey: `meeting_tasks:${meeting.id}:${[...updates.keys()].sort().join(',')}`,
        title,
        type: 'meeting_tasks_created',
        workspaceId: this.workspaceId ?? null,
      });
    } catch (error) {
      console.error('[meeting:createTasks] notification not sent', meeting.id, error);
    }
  }

  private async resolveModel() {
    const settings = await new UserModel(this.db, this.userId).getUserSettings();
    const systemAgent = settings?.systemAgent as Partial<UserSystemAgentConfig> | undefined;
    return resolveSystemAgentModelConfig({
      taskConfig: systemAgent?.meetingMinutes,
      taskKey: 'meetingMinutes',
    });
  }
}
