const OFF_VALUES = new Set(['0', 'off', 'false', 'no']);
const ON_VALUES = new Set(['1', 'on', 'true', 'yes']);

const normalize = (value: string | undefined) => (value ?? '').trim().toLowerCase();

/**
 * `RESUME_AFTER_DEPLOY=0` switches replay off entirely; anything else keeps it on.
 * It gates Tasks and, together with {@link isDeployChatResumeEnabled}, chats.
 */
export const isDeployResumeEnabled = (env: NodeJS.ProcessEnv = process.env): boolean =>
  !OFF_VALUES.has(normalize(env.RESUME_AFTER_DEPLOY));

/**
 * Plain conversations are replayed only on request (`RESUME_CHAT_AFTER_DEPLOY=1`).
 *
 * The two kinds cost different things. A Task replay continues its own topic
 * through the Task runner, so the interrupted work picks up where it stopped. A
 * chat replay re-sends the last user message as a new turn: the conversation
 * gains a message the person did not write, and a tool side effect or a
 * notification may fire twice. Tasks stay on by default; conversations opt in.
 *
 * The deploy script reads the same variable before it writes the queue, so off
 * also means no chat rows are recorded at all.
 */
export const isDeployChatResumeEnabled = (env: NodeJS.ProcessEnv = process.env): boolean =>
  ON_VALUES.has(normalize(env.RESUME_CHAT_AFTER_DEPLOY));
