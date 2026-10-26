/**
 * Keeps the page's two writers apart. Reply settings save themselves a moment after they change;
 * the Save button writes everything. Both replace the whole settings column, so if an autosave
 * built from the previously stored values landed after an explicit save, it would silently undo
 * what that save had just confirmed.
 *
 * - An explicit save cancels a pending autosave and waits for one already on its way.
 * - No autosave starts while an explicit save is running.
 * - Autosaves never overlap each other.
 */
export const createSaveCoordinator = () => {
  let explicit = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let autoRun: Promise<void> | undefined;

  const runAuto = async (save: () => Promise<void>) => {
    if (explicit || autoRun) return;
    autoRun = save().finally(() => {
      autoRun = undefined;
    });
    await autoRun;
  };

  return {
    /** Start an explicit save: drop the pending autosave and let a running one finish first. */
    beginExplicit: async () => {
      clearTimeout(timer);
      explicit = true;
      await autoRun?.catch(() => undefined);
    },
    dispose: () => clearTimeout(timer),
    endExplicit: () => {
      explicit = false;
    },
    /** An explicit save is running; an autosave that got this far should stand down. */
    isExplicit: () => explicit,
    runAuto,
    /** (Re)start the delay before an autosave. */
    scheduleAuto: (save: () => Promise<void>, delay: number) => {
      clearTimeout(timer);
      timer = setTimeout(() => void runAuto(save), delay);
    },
  };
};

export type SaveCoordinator = ReturnType<typeof createSaveCoordinator>;
