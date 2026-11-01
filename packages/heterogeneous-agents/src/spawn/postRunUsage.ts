import { readKimiCodeSessionUsage } from '../kimiCode/sessionUsage';
import type { PostRunUsage, PostRunUsageOptions } from '../types';

type PostRunUsageReader = (
  sessionId: string | undefined,
  options: PostRunUsageOptions,
) => Promise<PostRunUsage | undefined>;

/**
 * Agents whose token usage only lands on disk, keyed by agent type. Reading is
 * the Node side's job — the adapter just turns the result into events — so a
 * new entry here never pulls file-system code into the browser bundle.
 */
const POST_RUN_USAGE_READERS: Record<string, PostRunUsageReader> = {
  'kimi-code': (sessionId, { env }) => readKimiCodeSessionUsage(sessionId, { env }),
};

/** Best-effort: unknown agent types and missing logs resolve to `undefined`. */
export const readPostRunUsage = async (
  agentType: string,
  sessionId: string | undefined,
  options: PostRunUsageOptions = {},
): Promise<PostRunUsage | undefined> => POST_RUN_USAGE_READERS[agentType]?.(sessionId, options);
