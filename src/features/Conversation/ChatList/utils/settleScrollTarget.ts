interface SettleScrollTargetOptions {
  aimAt: (target: number) => void;
  initialTarget: number;
  isStale: () => boolean;
  maxMs: number;
  onDone: () => void;
  quietMs: number;
  readTarget: () => number | undefined;
  scroller: HTMLElement;
  stopEvents: readonly string[];
}

export const settleScrollTarget = ({
  aimAt,
  initialTarget,
  isStale,
  maxMs,
  onDone,
  quietMs,
  readTarget,
  scroller,
  stopEvents,
}: SettleScrollTargetOptions) => {
  let interrupted = false;
  const interrupt = () => {
    interrupted = true;
  };
  for (const type of stopEvents) scroller.addEventListener(type, interrupt, { passive: true });
  const stopListening = () => {
    for (const type of stopEvents) scroller.removeEventListener(type, interrupt);
  };

  const startedAt = Date.now();
  let lastChangeAt = startedAt;
  let lastTarget = initialTarget;
  let landedAt = scroller.scrollTop;
  const step = () => {
    if (isStale()) {
      stopListening();
      return;
    }
    const target = interrupted ? undefined : readTarget();
    if (target === undefined) {
      stopListening();
      onDone();
      return;
    }
    const now = Date.now();
    // Virtua shifts scrollTop on its own as rows above get measured, so a
    // target that holds still can still be missed. Drift is measured from where
    // the last aim landed, since a clamped target is never reached.
    if (target !== lastTarget || Math.abs(scroller.scrollTop - landedAt) > 1) {
      aimAt(target);
      landedAt = scroller.scrollTop;
      lastTarget = target;
      lastChangeAt = now;
    }
    if (now - lastChangeAt >= quietMs || now - startedAt >= maxMs) {
      stopListening();
      onDone();
      return;
    }
    requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
};
