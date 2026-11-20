import { PolicyLoad } from '@lobechat/agent-templates';
import { DEFAULT_SYSTEM_AGENT_ITEM, TRACING_SCENARIOS } from '@lobechat/const';
import {
  BOT_RETRO_JSON_SCHEMA,
  BOT_RETRO_PROMPT_VERSION,
  type BotRetroVentInput,
  chainBotRetro,
} from '@lobechat/prompts';
import { RequestTrigger } from '@lobechat/types';
import debug from 'debug';
import { z } from 'zod';

import { AgentBotRetroModel, type BotRetroVentRow } from '@/database/models/agentSignal/botRetro';
import type { LobeChatDatabase } from '@/database/type';
import { AgentDocumentsService } from '@/server/services/agentDocuments';
import { AgentDocumentVfsError } from '@/server/services/agentDocumentVfs/errors';
import { AiGenerationService } from '@/server/services/aiGeneration';

import {
  BOT_LESSONS_FILENAME,
  BOT_REFLECTION_FOLDER,
  BOT_RETRO_LOG_FILENAME,
  hasBotRetroLogEntry,
  parseBotLessons,
  prependBotRetroLogEntry,
  renderBotLessons,
  renderBotRetroLogEntry,
} from './documents';

export * from './documents';

const log = debug('lobe-server:agent-signal:bot-retro');

/** Bounds on how much of one day the retro reads. */
const MAX_TOPICS = 30;
const MAX_VENTS = 20;
const MAX_WAKE_MARKS = 30;

const BotRetroResultSchema = z.object({
  lessons: z.array(z.string().trim().min(1)).max(15),
  platformIssues: z
    .array(
      z.object({
        detail: z.string(),
        title: z.string().trim().min(1),
        ventId: z.string().nullable(),
      }),
    )
    .max(10),
  selfMistakes: z
    .array(
      z.object({
        lesson: z.string().trim().min(1),
        topicId: z.string().nullable(),
        what: z.string().trim().min(1),
      }),
    )
    .max(10),
  summary: z.string(),
});

export type BotRetroResult = z.infer<typeof BotRetroResultSchema>;

export interface RunBotRetroInput {
  agentId: string;
  /** Local review date, `YYYY-MM-DD`; also the retro log heading. */
  localDate: string;
  windowEnd: Date;
  windowStart: Date;
}

export type RunBotRetroOutcome =
  | { reason: 'already_reviewed' | 'no_bot_activity'; status: 'skipped' }
  | {
      lessonCount: number;
      platformIssueCount: number;
      selfMistakeCount: number;
      status: 'written';
    };

const readString = (value: unknown) =>
  typeof value === 'string' && value.trim() ? value.trim() : undefined;

/**
 * Normalizes one vent tool call into prompt input.
 *
 * Before:
 * - { arguments: '{"category":"platform_bug","summary":"…"}', state: { recorded: true } }
 *
 * After:
 * - { category: 'platform_bug', id: '<messageId>', recorded: true, summary: '…' }
 */
export const toBotRetroVent = (row: BotRetroVentRow): BotRetroVentInput => {
  let args: Record<string, unknown> = {};
  try {
    const parsed: unknown = JSON.parse(row.arguments ?? '{}');
    if (parsed && typeof parsed === 'object') args = parsed as Record<string, unknown>;
  } catch {
    // A malformed call still counts as a vent the agent tried to file.
  }

  return {
    category: readString(args.category),
    details: readString(args.details)?.slice(0, 500),
    id: row.messageId,
    recorded: row.state?.recorded !== false,
    severity: readString(args.severity),
    summary: readString(args.summary)?.slice(0, 200),
    topicId: row.topicId,
  };
};

/**
 * Nightly retro of a bot-connected agent over one local day of chat-platform conversations.
 *
 * Writes two agent documents: {@link BOT_LESSONS_FILENAME} (the merged lessons, loaded into every
 * future run) and {@link BOT_RETRO_LOG_FILENAME} (the dated entry: platform issues marked vented
 * or not, and the agent's own mistakes).
 */
export class BotRetroService {
  private readonly db: LobeChatDatabase;
  private readonly model: AgentBotRetroModel;
  private readonly userId: string;

  constructor(db: LobeChatDatabase, userId: string) {
    this.db = db;
    this.userId = userId;
    this.model = new AgentBotRetroModel(db, userId);
  }

  /** Agents that worked in a bot topic during the window, busiest first. */
  listTargets = (options: { limit: number; windowEnd: Date; windowStart: Date }) =>
    this.model.listBotActiveAgents(options);

  /**
   * Runs one agent's retro for one day.
   *
   * Idempotent per day: a log that already has the day's heading is left alone, so the hourly
   * scheduler can tick twice inside the night window.
   */
  runForAgent = async (input: RunBotRetroInput): Promise<RunBotRetroOutcome> => {
    const { agentId, localDate, windowEnd, windowStart } = input;
    const documents = new AgentDocumentsService(this.db, this.userId);

    const logDoc = await documents.getDocumentByFilename(agentId, BOT_RETRO_LOG_FILENAME);
    if (hasBotRetroLogEntry(logDoc?.content, localDate)) {
      return { reason: 'already_reviewed', status: 'skipped' };
    }

    const window = { agentId, windowEnd, windowStart };
    const [topics, ventRows, wakeMarks, agent, lessonsDoc] = await Promise.all([
      this.model.listBotTopics({ ...window, limit: MAX_TOPICS }),
      this.model.listVents({ ...window, limit: MAX_VENTS }),
      this.model.listOwnerWakeMarks({ ...window, limit: MAX_WAKE_MARKS }),
      this.model.getAgentMeta(agentId),
      documents.getDocumentByFilename(agentId, BOT_LESSONS_FILENAME),
    ]);

    if (topics.length === 0) return { reason: 'no_bot_activity', status: 'skipped' };

    const vents = ventRows.map(toBotRetroVent);
    const existingLessons = parseBotLessons(lessonsDoc?.content);

    const ai = new AiGenerationService(this.db, this.userId);
    const result = BotRetroResultSchema.parse(
      await ai.generateObject(
        {
          ...chainBotRetro({
            agent: { description: agent?.description, title: agent?.title },
            date: localDate,
            lessons: existingLessons,
            topics,
            vents,
            wakeMarks,
          }),
          model: DEFAULT_SYSTEM_AGENT_ITEM.model,
          provider: DEFAULT_SYSTEM_AGENT_ITEM.provider,
          schema: BOT_RETRO_JSON_SCHEMA,
        },
        {
          metadata: { trigger: RequestTrigger.AgentSignal },
          tracing: {
            agentId,
            metadata: { localDate },
            promptVersion: BOT_RETRO_PROMPT_VERSION,
            scenario: TRACING_SCENARIOS.BotRetro,
            schemaName: BOT_RETRO_JSON_SCHEMA.name,
          },
        },
      ),
    );

    // The folder is created on the first new document only, so a skipped day never leaves an
    // empty folder behind, and documents that already exist are updated wherever the owner keeps them.
    let folderId: string | null | undefined;
    const ensureFolder = async () => {
      if (folderId !== undefined) return folderId;
      try {
        folderId = (await documents.createFolder(agentId, BOT_REFLECTION_FOLDER)).folder.documentId;
      } catch (error) {
        // An ordinary document already holds the folder's name: keep the retro at the top level.
        if (!(error instanceof AgentDocumentVfsError && error.code === 'CONFLICT')) throw error;
        log('agent=%s folder name %s is taken by a document', agentId, BOT_REFLECTION_FOLDER);
        folderId = null;
      }
      return folderId;
    };
    const createInFolder = async (
      params: Parameters<AgentDocumentsService['upsertDocument']>[0],
    ) => {
      const created = await documents.upsertDocument(params);
      const parentId = await ensureFolder();
      if (!parentId) return;

      const [moved] = await documents.moveDocuments(agentId, [created.id], parentId);
      if (moved?.status === 'failed')
        log('agent=%s kept %s at the top level: %s', agentId, params.filename, moved.error);
    };

    // A vent id the model names but the agent never filed is a slip, not a vent.
    const ventIds = new Set(vents.map((vent) => vent.id));
    const platformIssues = result.platformIssues.map((issue) => ({
      detail: issue.detail,
      title: issue.title,
      vented: issue.ventId !== null && ventIds.has(issue.ventId),
    }));

    // An empty list from the model on a quiet day must not wipe the lessons the agent already has.
    const lessons = result.lessons.length > 0 ? result.lessons : existingLessons;
    if (lessons.length > 0 && lessons.join('\n') !== existingLessons.join('\n')) {
      if (lessonsDoc) {
        await documents.upsertDocumentByFilename({
          agentId,
          content: renderBotLessons(lessons),
          filename: BOT_LESSONS_FILENAME,
        });
      } else {
        await createInFolder({
          agentId,
          content: renderBotLessons(lessons),
          filename: BOT_LESSONS_FILENAME,
          policyLoad: PolicyLoad.ALWAYS,
        });
      }
    }

    const logContent = prependBotRetroLogEntry(
      logDoc?.content,
      renderBotRetroLogEntry({
        date: localDate,
        platformIssues,
        selfMistakes: result.selfMistakes,
        summary: result.summary,
      }),
    );
    if (logDoc) {
      await documents.upsertDocumentByFilename({
        agentId,
        content: logContent,
        filename: BOT_RETRO_LOG_FILENAME,
      });
    } else {
      await createInFolder({
        agentId,
        content: logContent,
        filename: BOT_RETRO_LOG_FILENAME,
        policyLoad: PolicyLoad.DISABLED,
      });
    }

    log(
      'agent=%s date=%s issues=%d mistakes=%d lessons=%d',
      agentId,
      localDate,
      platformIssues.length,
      result.selfMistakes.length,
      lessons.length,
    );

    return {
      lessonCount: lessons.length,
      platformIssueCount: platformIssues.length,
      selfMistakeCount: result.selfMistakes.length,
      status: 'written',
    };
  };
}
