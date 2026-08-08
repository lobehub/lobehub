interface ArmedMessageCandidate {
  content: string;
  createdAt: number;
  role: string;
}

/**
 * The message a pre-topic goal arm actually meant: the first user message sent
 * at or after the arm.
 *
 * A conversation can already hold earlier user messages (e.g. the default/inbox
 * conversation) that get carried into the new topic. Those predate `armedAt`, so
 * picking the *oldest* user message would either adopt the wrong text or — when
 * its timestamp is before the arm — skip adoption entirely and lose the goal.
 * Selecting the first message at/after `armedAt` both preserves the armed
 * message and keeps a stale arm from hijacking a pre-existing topic (whose
 * messages all predate the arm → `undefined`).
 */
export const pickArmedMessage = <T extends ArmedMessageCandidate>(
  messages: T[],
  armedAt: number,
): T | undefined => messages.find((m) => m.role === 'user' && m.createdAt >= armedAt);
