export type HeterogeneousAgentCancellationSignal = 'SIGINT' | 'SIGKILL' | 'SIGTERM';

/** Device-gateway confirmation that a heterogeneous-agent process tree stopped. */
export interface HeterogeneousAgentCancellationResult {
  /** Whether the complete wrapper-owned process tree exited before the bounded wait elapsed. */
  exited: boolean;
  /** Operating-system process id assigned to the wrapper process. */
  pid?: number;
  /** Initial signal requested by the server cancellation call. */
  signal: HeterogeneousAgentCancellationSignal;
}
