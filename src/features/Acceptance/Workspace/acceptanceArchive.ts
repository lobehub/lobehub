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
