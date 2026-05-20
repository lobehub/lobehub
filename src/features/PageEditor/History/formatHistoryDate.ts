import dayjs from 'dayjs';

export const formatHistoryAbsoluteTime = (savedAt: string) =>
  dayjs(savedAt).format('MMMM D, YYYY h:mm A');

export const formatHistoryRowTime = (savedAt: string) => dayjs(savedAt).format('h:mm A');
