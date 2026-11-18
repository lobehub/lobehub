export interface CheckPreciseScheduleAccessParams {
  userId: string;
  workspaceId?: string | null;
}

export type CheckPreciseScheduleAccessResult =
  { allowed: false; message: string } | { allowed: true };

/**
 * Decides whether a task schedule may pin a custom exact minute. The default
 * always allows it; a deployment with plan rules overrides it.
 */
export const checkPreciseScheduleAccess = async (
  _params: CheckPreciseScheduleAccessParams,
): Promise<CheckPreciseScheduleAccessResult> => ({ allowed: true });
