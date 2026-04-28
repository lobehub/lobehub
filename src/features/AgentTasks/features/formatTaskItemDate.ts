import dayjs from 'dayjs';

export interface TaskItemDateFormatOptions {
  formatOtherYear?: string;
  formatThisYear?: string;
  now?: Date | string;
}

export const formatTaskItemDate = (
  time?: string | Date | null,
  options: TaskItemDateFormatOptions = {},
) => {
  if (!time) return '';

  const date = dayjs(time);

  if (!date.isValid()) return '';

  const { formatOtherYear = 'MMM D, YYYY', formatThisYear = 'MMM D', now = new Date() } = options;
  const current = dayjs(now);

  return date.format(date.isSame(current, 'year') ? formatThisYear : formatOtherYear);
};
