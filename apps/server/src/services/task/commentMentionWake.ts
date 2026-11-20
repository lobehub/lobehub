import type { TaskCommentWake } from '@lobechat/types';
import { agentDisplayName } from '@lobechat/types';
import { TRPCError } from '@trpc/server';
import debug from 'debug';
import { inArray } from 'drizzle-orm';

import { TaskModel } from '@/database/models/task';
import type { TaskCommentItem } from '@/database/schemas';
import { agents, users } from '@/database/schemas';
import type { LobeChatDatabase } from '@/database/type';
import { agentUsableByWhere } from '@/database/utils/agent-access';
import { TaskRunnerService } from '@/server/services/taskRunner';

const log = debug('lobe-server:task:comment-mention-wake');

/** Same self-closing tag the comment editor writes for a mention. */
const MENTION_TAG = /<mention\s[^>]*?\/>/gi;
const MENTION_NAME = /\bname\s*=\s*(?:"([^"]*)"|'([^']*)')/i;

/** Comment markdown as a person reads it: `<mention name="Ada" … />` becomes `@Ada`. */
export const readableCommentText = (content: string): string =>
  content.replaceAll(MENTION_TAG, (tag) => {
    const match = MENTION_NAME.exec(tag);
    const name = match?.[1] ?? match?.[2];
    return name ? `@${name}` : '';
  });

const TITLE_LENGTH = 100;

/** The run's topic title: what the agent was asked, on one line. */
export const wakeRunTitle = (content: string): string | undefined => {
  const line = readableCommentText(content).replaceAll(/\s+/g, ' ').trim();
  if (!line) return undefined;
  return line.length > TITLE_LENGTH ? `${line.slice(0, TITLE_LENGTH - 1)}…` : line;
};

const escapeAttribute = (value: string) => value.replaceAll('"', '&quot;');

interface ThreadAuthorNames {
  agents: Map<string, string>;
  users: Map<string, string>;
}

/**
 * The instruction a woken agent runs with. The task prompt already carries
 * every comment; this says which thread asked, who is in it, and that the
 * answer goes back there.
 */
export const buildWakePrompt = (
  thread: Pick<
    TaskCommentItem,
    'authorAgentId' | 'authorUserId' | 'content' | 'createdAt' | 'id' | 'parentCommentId'
  >[],
  triggerId: string,
  names: ThreadAuthorNames,
): string => {
  const lines = thread.map((comment) => {
    const author = comment.authorAgentId
      ? `agent:${names.agents.get(comment.authorAgentId) ?? comment.authorAgentId}`
      : comment.authorUserId
        ? (names.users.get(comment.authorUserId) ?? comment.authorUserId)
        : 'unknown';
    const marker = comment.id === triggerId ? ' mentioned_you="true"' : '';
    return `<comment id="${comment.id}" author="${escapeAttribute(author)}"${marker}>${readableCommentText(comment.content)}</comment>`;
  });

  return [
    'You were @mentioned in a comment thread on this task. Answer the comment marked mentioned_you="true" — do the work it asks for if it asks for work.',
    'Your final message is posted back into this thread as your reply, so write it for the people in the thread: lead with the answer or the outcome, then what you did. Do not post it again as a task comment yourself.',
    `<comment_thread>\n${lines.join('\n')}\n</comment_thread>`,
  ].join('\n\n');
};

const loadAuthorNames = async (
  db: LobeChatDatabase,
  thread: Pick<TaskCommentItem, 'authorAgentId' | 'authorUserId'>[],
): Promise<ThreadAuthorNames> => {
  const userIds = [...new Set(thread.map((c) => c.authorUserId).filter((id) => !!id))] as string[];
  const agentIds = [
    ...new Set(thread.map((c) => c.authorAgentId).filter((id) => !!id)),
  ] as string[];
  const [userRows, agentRows] = await Promise.all([
    userIds.length > 0
      ? db
          .select({ fullName: users.fullName, id: users.id, username: users.username })
          .from(users)
          .where(inArray(users.id, userIds))
      : [],
    agentIds.length > 0
      ? db
          .select({ id: agents.id, name: agents.name, title: agents.title })
          .from(agents)
          .where(inArray(agents.id, agentIds))
      : [],
  ]);
  return {
    agents: new Map(
      agentRows.flatMap((a) => {
        const name = agentDisplayName(a);
        return name ? [[a.id, name]] : [];
      }),
    ),
    users: new Map(
      userRows.flatMap((u) => {
        const name = u.fullName || u.username;
        return name ? [[u.id, name]] : [];
      }),
    ),
  };
};

/**
 * Whether the caller may wake this agent on this task: an agent they may use,
 * and — on a public task — a public one, the same rule the assignee follows.
 * Anything else reads as "not found", never as a private agent's existence.
 */
const isWakeable = async (
  db: LobeChatDatabase,
  ctx: { userId: string; workspaceId?: string },
  agentId: string,
  taskVisibility: 'private' | 'public',
): Promise<boolean> => {
  const [agent] = await db
    .select({ visibility: agents.visibility })
    .from(agents)
    .where(agentUsableByWhere(agentId, ctx))
    .limit(1);
  if (!agent) return false;
  return taskVisibility === 'private' || agent.visibility !== 'private';
};

export interface WakeMentionedAgentsParams {
  /** The agents the comment @mentions, in the order they appear. */
  agentIds: string[];
  comment: TaskCommentItem;
  db: LobeChatDatabase;
  task: { id: string; visibility: 'private' | 'public' };
  userId: string;
  workspaceId?: string;
}

/**
 * Wake the agents a member @mentioned in a task comment.
 *
 * A Task runs one topic at a time, so one comment wakes one agent: the first
 * one mentioned that the caller may wake. Any other mentioned agent is
 * reported as `skipped`, so the author can see it did not run. A mention that
 * lands while the Task is already running reports `busy` and starts nothing;
 * the comment is still in the prompt of the Task's next run.
 *
 * The woken run executes as that agent without reassigning the Task, and its
 * output comes back as the agent's reply in the comment's thread.
 */
export const wakeMentionedAgents = async ({
  agentIds,
  comment,
  db,
  task,
  userId,
  workspaceId,
}: WakeMentionedAgentsParams): Promise<TaskCommentWake[]> => {
  const ctx = { userId, workspaceId };
  const wakes: TaskCommentWake[] = [];
  let woken = false;

  for (const agentId of agentIds) {
    if (woken) {
      wakes.push({ agentId, status: 'skipped' });
      continue;
    }
    if (!(await isWakeable(db, ctx, agentId, task.visibility))) {
      wakes.push({ agentId, status: 'unavailable' });
      continue;
    }

    woken = true;
    const rootId = comment.parentCommentId ?? comment.id;
    try {
      const thread = await new TaskModel(db, userId, workspaceId).getCommentThread(rootId);
      const prompt = buildWakePrompt(thread, comment.id, await loadAuthorNames(db, thread));
      const result = await new TaskRunnerService(db, userId, workspaceId).runTask({
        agentId,
        extraPrompt: prompt,
        replyToCommentId: rootId,
        taskId: task.id,
        title: wakeRunTitle(comment.content),
      });
      wakes.push({ agentId, status: 'started', topicId: result.topicId ?? undefined });
    } catch (error) {
      const busy = error instanceof TRPCError && error.code === 'CONFLICT';
      if (!busy) console.error('[task-comment] Failed to wake the mentioned agent', error);
      log('wake %s on %s: %s', agentId, task.id, busy ? 'busy' : 'failed');
      wakes.push({ agentId, status: busy ? 'busy' : 'failed' });
    }
  }

  return wakes;
};
