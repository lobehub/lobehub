export interface AcquireAgentRunSlotParams {
  /**
   * `false` counts the run without refusing it: a continuation of a run the
   * user already started (approval resume, queued follow-up) must not fail.
   */
  enforce: boolean;
  /** The run's operation id, or a provisional id later moved with {@link rebindAgentRunSlot}. */
  holderId: string;
  userId: string;
}

export interface AcquireAgentRunSlotResult {
  /** `false` once the user's cap on concurrent runs is reached. */
  acquired: boolean;
}

/**
 * Caps how many agent runs one user has in flight. The default never limits;
 * a deployment that enforces a cap overrides these four functions.
 */
export const acquireAgentRunSlot = async (
  _params: AcquireAgentRunSlotParams,
): Promise<AcquireAgentRunSlotResult> => ({ acquired: true });

/** Moves a slot taken under a provisional id to the operation id that owns it. */
export const rebindAgentRunSlot = async (
  _userId: string,
  _fromHolderId: string,
  _toHolderId: string,
): Promise<void> => {};

/** Keeps a running holder's slot from lapsing. */
export const renewAgentRunSlot = async (_userId: string, _holderId: string): Promise<void> => {};

/** Frees the holder's slot once its run ends. */
export const releaseAgentRunSlot = async (_userId: string, _holderId: string): Promise<void> => {};
