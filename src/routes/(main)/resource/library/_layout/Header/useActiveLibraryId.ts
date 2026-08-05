import { useActiveRouteParams } from '@/hooks/useActiveRouteParams';

export const useActiveLibraryId = () => useActiveRouteParams<{ id?: string }>().id ?? '';
