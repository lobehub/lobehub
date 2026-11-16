import { cssVar } from '@lobehub/ui';
import {
  ArchiveIcon,
  BoxIcon,
  DatabaseIcon,
  FileIcon,
  GitBranchIcon,
  ImageIcon,
  type LucideIcon,
  RecycleIcon,
} from 'lucide-react';

import type { StorageCategory } from './analysis';

export const CATEGORY_ICONS: Record<StorageCategory, LucideIcon> = {
  archives: ArchiveIcon,
  cache: RecycleIcon,
  dependencies: BoxIcon,
  environments: DatabaseIcon,
  git: GitBranchIcon,
  media: ImageIcon,
  other: FileIcon,
};

/**
 * The bar's segment colours, one per category, from the theme's semantic
 * palette so they follow light and dark. Regenerable categories take the
 * calm ones; the rest are told apart by hue, not by alarm.
 */
export const CATEGORY_COLORS: Record<StorageCategory, string> = {
  archives: cssVar.colorWarning,
  cache: cssVar.colorSuccess,
  dependencies: cssVar.colorPrimary,
  environments: cssVar.colorTextQuaternary,
  git: cssVar.purple,
  media: cssVar.geekblue,
  other: cssVar.colorTextTertiary,
};
