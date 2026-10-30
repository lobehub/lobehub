/**
 * A signal that aborts once any of `signals` does, like `AbortSignal.any`,
 * which Safari < 17.4, Chrome < 116 and Firefox < 124 lack. Call `dispose`
 * when done, so a long-lived source doesn't keep a listener per use.
 */
export const anySignal = (signals: AbortSignal[]) => {
  const controller = new AbortController();
  const dispose = () => {
    for (const signal of signals) signal.removeEventListener('abort', onAbort);
  };
  const onAbort = () => {
    dispose();
    controller.abort();
  };

  if (signals.some((signal) => signal.aborted)) controller.abort();
  else for (const signal of signals) signal.addEventListener('abort', onAbort, { once: true });

  return { dispose, signal: controller.signal };
};
