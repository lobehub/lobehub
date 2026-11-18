export interface WalkStep {
  id: string;
  title: string;
}

export const walkOrder = (
  nodes: { data: { title: string }; id: string; type?: string }[],
): WalkStep[] =>
  nodes
    .filter((node) => node.type === 'state')
    .map((node) => ({ id: node.id, title: node.data.title }));

export const walkNeighbors = (order: WalkStep[], selectedId: string | undefined) => {
  const index = order.findIndex((step) => step.id === selectedId);
  if (index < 0) return { next: order[0], position: 0, previous: undefined };
  return { next: order[index + 1], position: index + 1, previous: order[index - 1] };
};

const THUMBNAIL_TYPES = new Set(['screenshot', 'gif']);

export const latestThumbnail = (
  visits: { evidence: { fileUrl?: string | null; type: string }[] }[],
): string | undefined => {
  for (const visit of [...visits].reverse()) {
    const picture = visit.evidence.find((item) => item.fileUrl && THUMBNAIL_TYPES.has(item.type));
    if (picture?.fileUrl) return picture.fileUrl;
  }
  return undefined;
};

export const hasReviewRecord = (attempt: {
  reviewAttachments?: unknown[] | null;
  reviewComment?: string | null;
  reviewDetail?: { annotations?: unknown[] | null } | null;
}) =>
  Boolean(
    attempt.reviewComment ||
    attempt.reviewDetail?.annotations?.length ||
    attempt.reviewAttachments?.length,
  );
