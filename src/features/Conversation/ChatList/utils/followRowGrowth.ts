/**
 * How long the rows must stay still after a reply finished before auto-scroll stops following
 * them. A finished reply still grows: a card mounts its charts and measured layouts, markdown and
 * images settle in later commits.
 */
export const SETTLE_QUIET_MS = 1500;

interface FollowRowGrowthOptions {
  /** Called on every size change of the list content or one of its rows. */
  onGrow: () => void;
  /**
   * When set, called once the rows have not changed size for `SETTLE_QUIET_MS`, counted from the
   * start and restarted by every change.
   */
  onSettled?: () => void;
}

/**
 * Observes the list content and each rendered row, so growth that virtua has not measured yet is
 * followed before paint. Returns the cleanup.
 */
export const followRowGrowth = (
  content: Element,
  { onGrow, onSettled }: FollowRowGrowthOptions,
) => {
  let quiet: ReturnType<typeof setTimeout> | undefined;
  const armQuiet = () => {
    if (!onSettled) return;
    clearTimeout(quiet);
    quiet = setTimeout(onSettled, SETTLE_QUIET_MS);
  };

  const observer = new ResizeObserver(() => {
    onGrow();
    armQuiet();
  });
  observer.observe(content);
  for (const row of content.children) observer.observe(row);
  armQuiet();

  return () => {
    observer.disconnect();
    clearTimeout(quiet);
  };
};
