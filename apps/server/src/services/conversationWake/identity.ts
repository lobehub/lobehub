import { eq } from 'drizzle-orm';

import { agents } from '@/database/schemas/agent';
import { users } from '@/database/schemas/user';
import type { LobeChatDatabase } from '@/database/type';

/** Who the bot is and who owns it, as people know them: names and a title, never ids or contact data. */
export interface WakeIdentity {
  agentName?: string;
  agentTitle?: string;
  /** What the owner is called in LobeHub: their full name and username. */
  ownerNames: string[];
}

/** Names change rarely and each read is two queries on a path with a 2s deadline. */
const IDENTITY_TTL_MS = 5 * 60 * 1000;

const clean = (value: string | null | undefined) => value?.trim() || undefined;

/**
 * Reads the agent's name and title and the owner's names, for the classifier to tell "the
 * assistant" and "the person who set it up" apart.
 *
 * Returns:
 * - A loader that reads the database once per five minutes. A failed read is thrown and not
 *   remembered, so the next message tries again; callers treat it as "no identity yet".
 */
export const createWakeIdentityLoader = ({
  agentId,
  db,
  userId,
}: {
  agentId: string;
  db: LobeChatDatabase;
  userId: string;
}) => {
  let cached: { expiresAt: number; identity: WakeIdentity } | undefined;

  return async (): Promise<WakeIdentity> => {
    if (cached && cached.expiresAt > Date.now()) return cached.identity;

    const [agent, user] = await Promise.all([
      db.query.agents.findFirst({
        columns: { name: true, title: true },
        where: eq(agents.id, agentId),
      }),
      db.query.users.findFirst({
        columns: { fullName: true, username: true },
        where: eq(users.id, userId),
      }),
    ]);

    const identity: WakeIdentity = {
      agentName: clean(agent?.name),
      agentTitle: clean(agent?.title),
      ownerNames: [
        ...new Set([clean(user?.fullName), clean(user?.username)].filter((n): n is string => !!n)),
      ],
    };
    cached = { expiresAt: Date.now() + IDENTITY_TTL_MS, identity };

    return identity;
  };
};
