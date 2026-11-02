import type { QuickNoteResource } from '@/services/quickNote';

const BUCKET_ORDER: Record<string, number> = {
  conversation: 1,
  document: 2,
  page: 2,
  task: 0,
  topic: 1,
};

const resolveBucket = (resourceType: QuickNoteResource['resourceType']) =>
  BUCKET_ORDER[resourceType] ?? 3;

export const sortResources = (resources: QuickNoteResource[]): QuickNoteResource[] =>
  [...resources].sort((a, b) => {
    const bucketDiff = resolveBucket(a.resourceType) - resolveBucket(b.resourceType);
    if (bucketDiff !== 0) return bucketDiff;
    return b.createdAt - a.createdAt;
  });
