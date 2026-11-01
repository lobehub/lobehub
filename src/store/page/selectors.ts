import type { PageState } from './initialState';
import type { PageSectionScope } from './projection';
import { listSelectors } from './slices/list';

/** One Docs sidebar page section (`mine` / `shared`); `undefined` until first read. */
const pageSection = (scope: PageSectionScope) => (s: PageState) => s.pageSectionMap[scope];

/** A section's full paged list (the full-list panel); `undefined` until first read. */
const pageSectionList = (scope: PageSectionScope) => (s: PageState) => s.pageSectionListMap[scope];

export const pageSelectors = {
  ...listSelectors,
  pageSection,
  pageSectionList,
};
