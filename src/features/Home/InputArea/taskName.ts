const MAX_LENGTH = 60;

/**
 * A task created without a name renders as its bare identifier ("T-26") in every
 * list, so the composer derives one from the instruction's opening line.
 */
export const taskNameFromMessage = (message: string): string => {
  const firstLine = message.split('\n').find((line) => line.trim().length > 0) ?? '';
  const normalized = firstLine.trim().replaceAll(/\s+/gu, ' ');

  if (normalized.length <= MAX_LENGTH) return normalized;

  return `${normalized.slice(0, MAX_LENGTH).trimEnd()}…`;
};
