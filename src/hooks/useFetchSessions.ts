import { useSessionStore } from '@/store/session';

export const useFetchSessions = () => {
  const useFetchSessions = useSessionStore((s) => s.useFetchSessions);

  useFetchSessions(true);
};
