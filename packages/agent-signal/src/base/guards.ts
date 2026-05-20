import type { RuntimeProcessorResult } from './types';

/** Result of a runtime guard evaluation. */
export interface RuntimeGuardResult {
  delayMs?: number;
  ok: boolean;
  reason: string;
  wait: () => RuntimeProcessorResult;
}
