/** Built-in signal type constants. */
export const AGENT_SIGNAL_TYPES = {
  actionApplied: 'signal.action.applied',
  actionFailed: 'signal.action.failed',
  actionSkipped: 'signal.action.skipped',
} as const;

type ValueOf<TValue> = TValue[keyof TValue];

/** Built-in signal type union derived from the signal type constants. */
export type AgentSignalBuiltInSignalType = ValueOf<typeof AGENT_SIGNAL_TYPES>;
