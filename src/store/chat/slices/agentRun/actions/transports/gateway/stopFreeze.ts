import type { InterruptStopSnapshot } from '@lobechat/types';

/**
 * Stop control a live gateway event handler exposes for its local operation.
 */
interface GatewayStopFreezeControl {
  /**
   * Stop rendering further reply text and return the text shown right now,
   * or undefined when no streamed reply is on screen.
   */
  freeze: () => InterruptStopSnapshot | undefined;
  /** Resume rendering after a Stop request that did not land. */
  unfreeze: () => void;
}

/**
 * Keyed by the local operation id. Module-level rather than store state: the
 * controls are closures over a handler's private stream state, and every Stop
 * entry point (the composer's `cancelOperation` handler, the share visitor's
 * own stop hook) only knows the local operation id.
 */
const controls = new Map<string, GatewayStopFreezeControl>();

/**
 * Register a handler's stop control. Returns an unregister function that only
 * removes this control, so a reconnect's newer handler is never dropped by the
 * older one finishing.
 */
export const registerGatewayStopFreeze = (
  operationId: string,
  control: GatewayStopFreezeControl,
): (() => void) => {
  controls.set(operationId, control);
  return () => {
    if (controls.get(operationId) === control) controls.delete(operationId);
  };
};

/**
 * Freeze the gateway run's reply at what the user sees when pressing Stop.
 *
 * The server only notices the interrupt on its next abort poll, so the model
 * keeps streaming for a moment after Stop. The frozen text goes with the
 * interrupt request so the server cuts its persisted reply back to it, keeping
 * the stopped reply identical after a reload (LOBE-14836).
 */
export const freezeGatewayRunForStop = (operationId: string): InterruptStopSnapshot | undefined =>
  controls.get(operationId)?.freeze();

/**
 * Resume rendering a run whose interrupt request failed and is still going.
 */
export const unfreezeGatewayRunForStop = (operationId: string): void => {
  controls.get(operationId)?.unfreeze();
};
