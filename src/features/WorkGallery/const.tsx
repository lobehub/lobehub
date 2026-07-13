import type { WorkSkillProvider, WorkType } from '@lobechat/types';
import { Github, type IconType } from '@lobehub/icons';
import type { IconProps } from '@lobehub/ui';
import { ClipboardListIcon, FileTextIcon, LayoutPanelTopIcon } from 'lucide-react';
import type { ComponentProps, FC } from 'react';

import RawLinearIcon from '@/features/Work/icons/LinearIcon';

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

/**
 * `?works=` values: the per-type tabs (task / document) plus the per-PROVIDER
 * tabs (linear / github) and a combined `all` view. Tabs stay user-facing
 * per-provider even though linear/github share the unified `external` Work type
 * — so the key set can no longer be `'all' | WorkType`.
 */
export type WorkGalleryKey = 'all' | 'document' | 'github' | 'linear' | 'task';

/**
 * How a gallery key narrows the workspace Work list: `type` selects a Work type
 * (task / document); `provider` narrows the `external` type to one skill
 * provider (linear / github); `all` carries neither (combined view).
 */
export interface WorkGalleryFilter {
  provider?: WorkSkillProvider;
  type?: WorkType;
}

export interface WorkGalleryEntry {
  /** Empty for the combined `all` view. */
  filter: WorkGalleryFilter;
  icon: IconProps['icon'];
  key: WorkGalleryKey;
}

/**
 * The five entries of the resource page's 产物 group, in display order. Icons
 * mirror `WorkSummaryCard` so a card and its sidebar entry read as the same
 * thing; `all` reuses the file "All" glyph for visual parity with the sibling
 * category menu.
 */
export const WORK_GALLERY_ENTRIES: WorkGalleryEntry[] = [
  { filter: {}, icon: LayoutPanelTopIcon, key: 'all' },
  { filter: { type: 'task' }, icon: ClipboardListIcon, key: 'task' },
  { filter: { type: 'document' }, icon: FileTextIcon, key: 'document' },
  { filter: { provider: 'linear' }, icon: LinearIcon, key: 'linear' },
  { filter: { provider: 'github' }, icon: GithubIcon, key: 'github' },
];

const FILTER_BY_KEY = new Map<WorkGalleryKey, WorkGalleryFilter>(
  WORK_GALLERY_ENTRIES.map((entry) => [entry.key, entry.filter]),
);

/** Parse the raw `?works=` param into a valid key, or null when absent/invalid. */
export const parseWorkGalleryKey = (value: string | null): WorkGalleryKey | null =>
  value && FILTER_BY_KEY.has(value as WorkGalleryKey) ? (value as WorkGalleryKey) : null;

/** The type/provider filter a key maps to (`all` → `{}`, no filter). */
export const workFilterFromKey = (key: WorkGalleryKey): WorkGalleryFilter =>
  FILTER_BY_KEY.get(key) ?? {};
