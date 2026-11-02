import { INBOX_SESSION_ID } from '@lobechat/const';
import { and, eq, exists, inArray, isNull, or } from 'drizzle-orm';

import type { FtsSearchCandidateSource } from '../../repositories/ftsSearch';
import {
  agents,
  agentsToSessions,
  messagePlugins,
  messages,
  messageTranslates,
  messageTTS,
  topics,
} from '../../schemas';
import type { LobeChatDatabase } from '../../type';
import { idGenerator } from '../../utils/idGenerator';
import { notShareVisitorMessage } from '../../utils/shareVisitor';
import { buildWorkspaceWhere } from '../../utils/workspace';
import type { MessageModelOptions } from './types';

export type MessageScopeArgs = ConstructorParameters<typeof MessageScope>;

/**
 * Shared user/workspace scope of every `MessageModel` sub-domain: the
 * constructor arguments plus the ownership predicates and id/match helpers
 * that each query and mutation module builds on.
 */
export class MessageScope {
  protected userId: string;

  protected db: LobeChatDatabase;

  protected ftsSearchCandidateSource?: FtsSearchCandidateSource;

  protected workspaceId?: string;

  /**
   * When true, {@link ownership} (and by extension every creator-scoped
   * read/write below) stops ANDing {@link notShareVisitorMessage}. Reserved
   * for surfaces that are share-runtime by design (agent-share visitor
   * router, share-scoped abuse guards) and for the agent runtime paths that
   * persist or clean up a visitor turn under the CREATOR's identity.
   * Defaults to false so every ordinary creator-facing caller fails closed.
   */
  protected includeShareVisitor: boolean;

  constructor(
    db: LobeChatDatabase,
    userId: string,
    workspaceId?: string,
    ftsSearchCandidateSource?: FtsSearchCandidateSource,
    options: MessageModelOptions = {},
  ) {
    this.userId = userId;
    this.db = db;
    this.workspaceId = workspaceId;
    this.ftsSearchCandidateSource = ftsSearchCandidateSource;
    this.includeShareVisitor = options.includeShareVisitor ?? false;
  }

  /**
   * Workspace/user scope plus the live parent-topic fence, WITHOUT the visitor
   * exclusion. Topic-less rows remain valid. Backing store for
   * {@link ownership} and the escape hatch for methods that resolve the
   * effective visitor gate per-call ({@link deleteMessage},
   * {@link deleteMessages}, {@link query} via `allowShareVisitor`, …).
   */
  protected workspaceScope = () =>
    and(
      buildWorkspaceWhere({ userId: this.userId, workspaceId: this.workspaceId }, messages),
      or(
        isNull(messages.topicId),
        inArray(
          messages.topicId,
          this.db
            .select({ id: topics.id })
            .from(topics)
            .where(
              buildWorkspaceWhere({ userId: this.userId, workspaceId: this.workspaceId }, topics),
            ),
        ),
      ),
    );

  /**
   * Default visitor exclusion applied by {@link ownership} — see
   * `notShareVisitorMessage` in `../utils/shareVisitor`. Returns `undefined`
   * when the instance was constructed with `includeShareVisitor: true`.
   */
  protected notShareVisitor = () =>
    this.includeShareVisitor ? undefined : notShareVisitorMessage();

  protected ownership = () => and(this.workspaceScope(), this.notShareVisitor());

  /**
   * One indexed lookup of a topic's `senderId` in this user/workspace scope
   * (`buildWorkspaceWhere` on `topics`). Returned once and reused: every row
   * that belongs to a topic shares that topic's visitor/creator identity, so
   * once the topic itself has been classified the per-row NOT EXISTS predicate
   * from {@link notShareVisitorMessage} is redundant for the rest of the same
   * call. Callers pass the resolved verdict downstream (as
   * `allowShareVisitor: true` for a verified creator topic) to swap the
   * relevant `ownership()` sites over to plain `workspaceScope()`.
   *
   * Fails closed: returns `'visitor'` when the topic doesn't exist under this
   * scope OR carries a non-null `senderId`, so an unauthorized topicId gets
   * the same empty result as before.
   */
  protected resolveTopicVisitorScope = async (topicId: string): Promise<'creator' | 'visitor'> => {
    const rows = await this.db
      .select({ senderId: topics.senderId })
      .from(topics)
      .where(
        and(
          buildWorkspaceWhere({ userId: this.userId, workspaceId: this.workspaceId }, topics),
          eq(topics.id, topicId),
        ),
      )
      .limit(1);
    if (rows.length === 0) return 'visitor';
    return rows[0].senderId === null ? 'creator' : 'visitor';
  };

  /**
   * Scope predicate without the recycle-bin filter — restore / purge internals
   * only. Keeps the visitor exclusion of {@link ownership} so a creator-facing
   * restore or purge can never reach an agent-share visitor row.
   */
  protected trashScope = () =>
    and(
      buildWorkspaceWhere(
        { includeTrashed: true, userId: this.userId, workspaceId: this.workspaceId },
        messages,
      ),
      this.notShareVisitor(),
    );

  protected pluginsOwnership = () =>
    buildWorkspaceWhere({ userId: this.userId, workspaceId: this.workspaceId }, messagePlugins);

  protected translatesOwnership = () =>
    buildWorkspaceWhere({ userId: this.userId, workspaceId: this.workspaceId }, messageTranslates);

  protected ttsOwnership = () =>
    buildWorkspaceWhere({ userId: this.userId, workspaceId: this.workspaceId }, messageTTS);

  protected agentsToSessionsOwnership = () =>
    buildWorkspaceWhere({ userId: this.userId, workspaceId: this.workspaceId }, agentsToSessions);

  // 18-char hash (was 14): widen the message id space — the coordinator-driven
  // hetero subagent flow allocates many ids per run, and a few extra chars keep
  // collision odds negligible at that volume.
  protected genId = () => idGenerator('messages', 18);

  /** Read and clear the same orphan history, only for the actual scoped Inbox. */
  protected matchLegacyInbox = (agentId: string) => {
    const inbox = this.db
      .select({ id: agents.id })
      .from(agents)
      .where(
        and(
          eq(agents.id, agentId),
          eq(agents.slug, INBOX_SESSION_ID),
          buildWorkspaceWhere({ userId: this.userId, workspaceId: this.workspaceId }, agents),
        ),
      );
    return and(
      isNull(messages.agentId),
      isNull(messages.sessionId),
      isNull(messages.groupId),
      isNull(messages.topicId),
      exists(inbox),
    );
  };

  protected matchSession = (sessionId?: string | null) => {
    if (sessionId === INBOX_SESSION_ID) return isNull(messages.sessionId);

    return sessionId ? eq(messages.sessionId, sessionId) : isNull(messages.sessionId);
  };

  protected matchTopic = (topicId?: string | null) =>
    topicId ? eq(messages.topicId, topicId) : isNull(messages.topicId);

  protected matchGroup = (groupId?: string | null) =>
    groupId ? eq(messages.groupId, groupId) : isNull(messages.groupId);

  protected matchThread = (threadId?: string | null) => {
    if (!!threadId) return eq(messages.threadId, threadId);
    return isNull(messages.threadId);
  };
}
