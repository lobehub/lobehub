import type { ViewMode } from '@/features/ResourceManager/store/initialState';
import { FilesTabs } from '@/types/files';

const GALLERY_FIRST_CATEGORIES = new Set<FilesTabs>([
  FilesTabs.Audios,
  FilesTabs.Images,
  FilesTabs.Videos,
  FilesTabs.Websites,
]);

export const getDefaultResourceViewMode = (category: FilesTabs, libraryId?: string): ViewMode =>
  !libraryId && GALLERY_FIRST_CATEGORIES.has(category) ? 'masonry' : 'list';
