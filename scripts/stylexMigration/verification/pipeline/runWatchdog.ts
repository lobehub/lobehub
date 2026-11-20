/** Deadline exits must allow owned-source cleanup; SIGKILL remains unrecoverable. */
export const armRunWatchdog = (options: {
  cleanup: () => Promise<void>;
  durationMs: number;
  report?: (message: unknown) => void;
  terminate?: (code: number) => void;
}) => {
  const report = options.report ?? console.error;
  const terminate = options.terminate ?? ((code: number) => process.exit(code));
  const timer = setTimeout(() => {
    report('ERROR: VERIFICATION_TIME_BUDGET_EXCEEDED');
    const grace = setTimeout(() => {
      report('ERROR: SOURCE_CLEANUP_TIME_BUDGET_EXCEEDED');
      terminate(3);
    }, 120_000);
    void options
      .cleanup()
      .catch(report)
      .finally(() => {
        clearTimeout(grace);
        terminate(3);
      });
  }, options.durationMs);
  timer.unref();
  return () => clearTimeout(timer);
};
