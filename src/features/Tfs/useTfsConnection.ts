import { useTfsData } from '@/store/tfs/action';

export const useTfsConnection = () => {
  const query = useTfsData({ kind: 'status' });
  return { ...query, connection: query.data?.connection };
};
