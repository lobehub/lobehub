import type { WorkType } from '@lobechat/types';
import { Github, type IconType } from '@lobehub/icons';
import type { IconProps } from '@lobehub/ui';
import { ClipboardListIcon, FileTextIcon, LayoutPanelTopIcon } from 'lucide-react';
import type { ComponentProps, FC } from 'react';

import RawLinearIcon from '@/features/AgentTasks/features/icons/LinearIcon';

/**
 * `@lobehub/ui`'s `<Icon>` (used by NavItem) injects `fill="transparent"` — the
 * right default for lucide's stroke-based glyphs, but it erases the fill of the
 * Linear / GitHub brand logomarks, rendering them invisible. Re-assert
 * `fill="currentColor"` after the injected props so each mark fills with the
 * row's (active/inactive-tinted) text color, matching how tool-call rows render
 * the same marks.
 */
const LinearIcon: FC<ComponentProps<IconType>> = (props) => (
  <RawLinearIcon {...props} fill={'currentColor'} />
);
const GithubIcon: FC<ComponentProps<IconType>> = (props) => (
  <Github {...props} fill={'currentColor'} />
);

/** `?works=` values: the four Work types plus a combined `all` view. */
export type WorkGalleryKey = 'all' | WorkType;

export interface WorkGalleryEntry {
  icon: IconProps['icon'];
  key: WorkGalleryKey;
  /** null = combined view (no type filter). */
  type: WorkType | null;
}

/**
 * The five entries of the resource page's 产物 group, in display order. Icons
 * mirror `WorkSummaryCard` so a card and its sidebar entry read as the same
 * thing; `all` reuses the file "All" glyph for visual parity with the sibling
 * category menu.
 */
export const WORK_GALLERY_ENTRIES: WorkGalleryEntry[] = [
  { icon: LayoutPanelTopIcon, key: 'all', type: null },
  { icon: ClipboardListIcon, key: 'task', type: 'task' },
  { icon: FileTextIcon, key: 'document', type: 'document' },
  { icon: LinearIcon, key: 'linear', type: 'linear' },
  { icon: GithubIcon, key: 'github', type: 'github' },
];

const VALID_KEYS = new Set<string>(WORK_GALLERY_ENTRIES.map((entry) => entry.key));

/** Parse the raw `?works=` param into a valid key, or null when absent/invalid. */
export const parseWorkGalleryKey = (value: string | null): WorkGalleryKey | null =>
  value && VALID_KEYS.has(value) ? (value as WorkGalleryKey) : null;

/** The type filter a key maps to (`all` → null, no filter). */
export const workTypeFromKey = (key: WorkGalleryKey): WorkType | null =>
  key === 'all' ? null : key;
