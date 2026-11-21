import { INBOX_SESSION_ID } from '@lobechat/const';
import { TRPCError } from '@trpc/server';
import { and, eq, inArray } from 'drizzle-orm';

import { agents, agentsToSessions, sessions } from '@/database/schemas';
import type { LobeChatDatabase } from '@/database/type';
import { buildWorkspaceWhere } from '@/database/utils/workspace';

export interface AgentReference {
  agentId: string;
  sessionId: string | null;
}

/** Only an entirely unprovisioned Inbox may enter the builtin creation path. */
export class InboxNotProvisionedError extends Error {}

/** Resolves identity and scope only. Callers must still apply their operation's ACL. */
export const resolveAgentReference = async (
  id: string,
  db: LobeChatDatabase,
  userId: string,
  workspaceId?: string,
): Promise<AgentReference> => {
  const scope = { userId, workspaceId };
  const inbox = id === INBOX_SESSION_ID || id === 'ssn_inbox';
  // Prefixes route known identities; imported/custom Agent ids still require
  // the same scoped database lookup, never authorization by their spelling.
  if (id.startsWith('agt_') || (!id.startsWith('ssn_') && !inbox)) {
    const agent = await db.query.agents.findFirst({
      columns: { id: true },
      where: and(eq(agents.id, id), buildWorkspaceWhere(scope, agents)),
    });
    if (agent) return { agentId: agent.id, sessionId: null };
    if (id.startsWith('agt_'))
      throw new TRPCError({ code: 'NOT_FOUND', message: 'Agent not found' });
  }

  // ssn_inbox is a historical alias, not a prefix substitution. Prefer its
  // real relationship when present; otherwise resolve the scoped inbox slug.
  const session =
    (await db.query.sessions.findFirst({
      columns: { id: true, type: true },
      where: and(eq(sessions.id, id), buildWorkspaceWhere(scope, sessions)),
    })) ??
    (inbox
      ? await db.query.sessions.findFirst({
          columns: { id: true, type: true },
          where: and(eq(sessions.slug, INBOX_SESSION_ID), buildWorkspaceWhere(scope, sessions)),
        })
      : undefined);

  if (session) {
    // Count every link before filtering agent visibility/trash. Filtering first
    // would turn a multi-agent shell into an accidental single-agent alias.
    const links = await db
      .select({ agentId: agentsToSessions.agentId })
      .from(agentsToSessions)
      .where(
        and(
          eq(agentsToSessions.sessionId, session.id),
          buildWorkspaceWhere(scope, agentsToSessions),
        ),
      );
    if (session.type === 'group' || links.length > 1) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: 'A group or multi-agent session is not an agent context',
      });
    }
    if (links.length === 1) {
      const agent = await db.query.agents.findFirst({
        columns: { id: true },
        where: and(eq(agents.id, links[0].agentId), buildWorkspaceWhere(scope, agents)),
      });
      if (agent) return { agentId: agent.id, sessionId: session.id };
    }
  } else if (inbox) {
    const agent = await db.query.agents.findFirst({
      columns: { id: true },
      where: and(eq(agents.slug, INBOX_SESSION_ID), buildWorkspaceWhere(scope, agents)),
    });
    if (agent) return { agentId: agent.id, sessionId: null };

    // A hidden/trashed builtin still occupies the identity. Do not fall into
    // builtin provisioning: its legacy adoption path is not a visibility read.
    const occupied = await db.query.agents.findFirst({
      columns: { id: true },
      where: and(
        eq(agents.slug, INBOX_SESSION_ID),
        buildWorkspaceWhere(
          { ...scope, includeTrashed: true },
          {
            userId: agents.userId,
            workspaceId: agents.workspaceId,
          },
        ),
      ),
    });
    if (!occupied) {
      throw new TRPCError({
        cause: new InboxNotProvisionedError(),
        code: 'NOT_FOUND',
        message: 'Inbox not provisioned',
      });
    }
  }

  throw new TRPCError({ code: 'NOT_FOUND', message: 'Agent context not found' });
};

/** Resolve database Session IDs in one scoped query, without choosing a group member. */
export const batchResolveSessionAgentIds = async (
  sessionIds: string[],
  db: LobeChatDatabase,
  userId: string,
  workspaceId?: string,
): Promise<Map<string, string>> => {
  if (!sessionIds.length) return new Map();
  const scope = { userId, workspaceId };
  const rows = await db
    .select({
      agentId: agentsToSessions.agentId,
      sessionId: sessions.id,
      type: sessions.type,
      visibleAgentId: agents.id,
    })
    .from(sessions)
    .innerJoin(
      agentsToSessions,
      and(
        eq(agentsToSessions.sessionId, sessions.id),
        buildWorkspaceWhere(scope, agentsToSessions),
      ),
    )
    .leftJoin(
      agents,
      and(eq(agents.id, agentsToSessions.agentId), buildWorkspaceWhere(scope, agents)),
    )
    .where(and(inArray(sessions.id, sessionIds), buildWorkspaceWhere(scope, sessions)));
  const groups = new Map<string, typeof rows>();
  for (const row of rows) groups.set(row.sessionId, [...(groups.get(row.sessionId) ?? []), row]);
  const result = new Map<string, string>();
  for (const [sessionId, links] of groups) {
    if (links.length === 1 && links[0].type !== 'group' && links[0].visibleAgentId) {
      result.set(sessionId, links[0].visibleAgentId);
    }
  }
  return result;
};
