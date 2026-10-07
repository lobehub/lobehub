export const BUN_CHECK_MIN = [1, 4, 3] as const;

export const bunCheckSupported = (version: string | undefined): boolean => {
  if (!version) return false;
  const core = version.split('-')[0] ?? '';
  const parts = core.split('.').map(Number);
  if (parts.length < 3 || parts.some((n) => !Number.isFinite(n))) return false;
  const [maj, min, patch] = parts as [number, number, number];
  const [needMaj, needMin, needPatch] = BUN_CHECK_MIN;
  if (maj !== needMaj) return maj > needMaj;
  if (min !== needMin) return min > needMin;
  return patch >= needPatch;
};
