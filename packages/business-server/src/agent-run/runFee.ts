export interface HoldAgentRunFeeParams {
  /** The run's operation id, or a provisional id later moved with {@link rebindAgentRunFee}. */
  holderId: string;
  userId: string;
}

export interface SettleAgentRunFeeParams {
  /** How long the run took, from its start to this terminal state. */
  durationMs?: number;
  operationId: string;
  /** The terminal reason the run ended with (`done`, `error`, `interrupted`, …). */
  reason: string;
  userId: string;
}

/**
 * A fee for each agent run a user starts, held when the run is admitted and
 * settled when it ends. The default never charges; a deployment that bills
 * runs overrides these four functions.
 *
 * Hold runs before the turn writes any row, and before Desktop spawns an
 * external agent it runs locally. A deployment that refuses a run the user
 * cannot pay for throws a `TRPCError` whose message is
 * `ChatErrorType.InsufficientBudgetForAgentRunFee`, holding nothing: a server
 * turn then writes nothing and the message stays in the composer under a
 * notice that says why, and Desktop does not start the CLI.
 */
export const holdAgentRunFee = async (_params: HoldAgentRunFeeParams): Promise<void> => {};

/** Moves a fee held under a provisional id to the operation id that owns it. */
export const rebindAgentRunFee = async (
  _userId: string,
  _fromHolderId: string,
  _toHolderId: string,
): Promise<void> => {};

/** Gives back the fee of a run that never started. */
export const releaseAgentRunFee = async (_userId: string, _holderId: string): Promise<void> => {};

/**
 * Charges or gives back the run's fee once it ends. Called for every terminal
 * operation; an operation that held no fee is a no-op.
 */
export const settleAgentRunFee = async (_params: SettleAgentRunFeeParams): Promise<void> => {};
