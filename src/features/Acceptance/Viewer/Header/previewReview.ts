const ACTIVATION_PARAM = 'lh-acceptance';

interface RoundLike {
  run: { metadata?: unknown };
}

export const previewReviewUrl = (acceptanceId: string, rounds: RoundLike[]) => {
  const metadata = rounds.at(-1)?.run.metadata as { previewUrl?: unknown } | null | undefined;
  if (typeof metadata?.previewUrl !== 'string') return null;
  try {
    const url = new URL(metadata.previewUrl);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
    url.searchParams.set(ACTIVATION_PARAM, acceptanceId);
    return url.toString();
  } catch {
    return null;
  }
};
