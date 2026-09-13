import type { AcceptancePurgePreview } from '@/services/verify';

export const ACCEPTANCE_ARCHIVE_RETENTION_DAYS = 30;
export const ACCEPTANCE_ARCHIVE_WARNING_DAYS = 7;

const DAY_MS = 86_400_000;

export const archiveDaysLeft = (archivedAt: Date | string, now: Date = new Date()): number => {
  const elapsed = Math.floor((now.getTime() - new Date(archivedAt).getTime()) / DAY_MS);
  return Math.min(
    ACCEPTANCE_ARCHIVE_RETENTION_DAYS,
    Math.max(0, ACCEPTANCE_ARCHIVE_RETENTION_DAYS - elapsed),
  );
};

export const sumPurgePreviews = (previews: AcceptancePurgePreview[]): AcceptancePurgePreview =>
  previews.reduce(
    (total, preview) => ({
      bytes: total.bytes + preview.bytes,
      fileCount: total.fileCount + preview.fileCount,
      files: {
        images: total.files.images + preview.files.images,
        other: total.files.other + preview.files.other,
        videos: total.files.videos + preview.files.videos,
      },
      rounds: total.rounds + preview.rounds,
    }),
    { bytes: 0, fileCount: 0, files: { images: 0, other: 0, videos: 0 }, rounds: 0 },
  );
