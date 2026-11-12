import { useChangelogIndex, useChangelogPost, useChangelogStore } from '@/store/changelog';

/** The changelog index; a reload paints the persisted copy while the server confirms it. */
export const useChangelogModalIndex = () => {
  useChangelogStore((s) => s.useFetchChangelogIndex)();
  return useChangelogIndex();
};

/** One changelog post in `locale`; `undefined` while loading, `null` when missing. */
export const useChangelogModalPost = (id: string, locale: string) => {
  useChangelogStore((s) => s.useFetchChangelogPost)({ id, locale });
  return useChangelogPost({ id, locale });
};
