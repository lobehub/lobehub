'use client';

import { createSearchLocalFilesInspector } from '@lobechat/shared-tool-ui/inspectors';

export const SearchLocalFilesInspector = createSearchLocalFilesInspector({
  noResultsKey: 'builtins.lobe-local-system.inspector.noResults',
  translationKey: 'builtins.lobe-local-system.apiName.searchLocalFiles',
});
