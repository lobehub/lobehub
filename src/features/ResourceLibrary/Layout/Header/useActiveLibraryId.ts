import { useParams } from '@/libs/router/navigation';

export const useActiveLibraryId = () => useParams<{ id?: string }>('id').id ?? '';
