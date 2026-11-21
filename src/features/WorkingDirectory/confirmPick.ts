/**
 * Apply a pick, then close — or, if applying it failed, stay open and say so.
 * Closing first would make a failed save look like a pick that took, with the
 * old folder still in use and nothing to retry from.
 */
export const confirmPick = async ({
  apply,
  close,
  fail,
}: {
  apply: () => void | Promise<void>;
  close: () => void;
  fail: (error: unknown) => void;
}): Promise<void> => {
  try {
    await apply();
  } catch (error) {
    fail(error);
    return;
  }
  close();
};
