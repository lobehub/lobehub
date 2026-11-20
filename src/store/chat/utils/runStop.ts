import { toast } from '@lobehub/ui';
import { t } from 'i18next';

/**
 * Why the server could not end a device-hosted run (`aiAgent.interruptTask`'s
 * `failureReason`).
 * - `runner_unreachable`: the device is offline or no longer holds the process,
 *   but the run reported recently enough that it may still be running there.
 * - `runner_unconfirmed`: the device answered but did not confirm the exit.
 */
export type RunStopFailureReason = 'runner_unconfirmed' | 'runner_unreachable';

/**
 * A stop the server could not confirm. Cancel handlers throw it so the
 * operation layer can say why the stop failed, and offer to force it, instead
 * of a bare "try again".
 */
export class RunStopUnconfirmedError extends Error {
  readonly failureReason?: RunStopFailureReason;

  constructor(message: string, failureReason?: RunStopFailureReason) {
    super(message);
    this.name = 'RunStopUnconfirmedError';
    this.failureReason = failureReason;
  }
}

/** The server's reason for an unconfirmed stop, when the error carries one. */
export const readRunStopFailureReason = (error: unknown): RunStopFailureReason | undefined =>
  error instanceof RunStopUnconfirmedError ? error.failureReason : undefined;

const FAILURE_KEYS: Record<RunStopFailureReason, string> = {
  runner_unconfirmed: 'runStop.failed.runnerUnconfirmed',
  runner_unreachable: 'runStop.failed.runnerUnreachable',
};

/**
 * Tell the person a stop failed and why. With `onForceStop`, offer to end the
 * run anyway: without it, a run whose device cannot confirm the exit has no
 * way out but waiting.
 */
export const notifyRunStopFailed = (
  reason: RunStopFailureReason | undefined,
  onForceStop?: () => void,
) => {
  const why = reason ? t(FAILURE_KEYS[reason], { ns: 'chat' }) : undefined;
  const hint = onForceStop ? t('runStop.forceEndHint', { ns: 'chat' }) : undefined;

  toast.error({
    actions: onForceStop
      ? [{ label: t('runStop.forceEnd', { ns: 'chat' }), onClick: onForceStop, variant: 'danger' }]
      : undefined,
    description: [why, hint].filter(Boolean).join(' ') || undefined,
    // Long enough to read the reason and reach the button.
    duration: onForceStop ? 15_000 : undefined,
    id: 'run-stop-failed',
    title: t('backgroundActivity.stopFailed', { ns: 'chat' }),
  });
};

/** The run was over because its device runner was gone; the stop settled it. */
export const notifyRunEndedWithoutRunner = () => {
  toast.info({
    id: 'run-stop-runner-gone',
    title: t('runStop.ended.runnerGone', { ns: 'chat' }),
  });
};
