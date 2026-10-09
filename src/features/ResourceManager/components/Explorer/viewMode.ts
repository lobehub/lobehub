import type { ViewMode } from '@/features/ResourceManager/store/initialState';
import type { FilesTabs } from '@/types/files';

// Type-only on `@/types/files`: the route skeleton reads this from the entry
// chunk, and the value import would drag that barrel's zod schemas in with it.
const GALLERY_FIRST_CATEGORIES = new Set<`${FilesTabs}`>([
  'audios',
  'images',
  'videos',
  'websites',
]);

export const getDefaultResourceViewMode = (
  category: `${FilesTabs}`,
  libraryId?: string,
): ViewMode => (!libraryId && GALLERY_FIRST_CATEGORIES.has(category) ? 'masonry' : 'list');
