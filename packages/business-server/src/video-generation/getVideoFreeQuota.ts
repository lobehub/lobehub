export async function getVideoFreeQuota(
  _userId: string,
  _model: string,
): Promise<{ limit: number; used: number } | null> {
  return null;
}
