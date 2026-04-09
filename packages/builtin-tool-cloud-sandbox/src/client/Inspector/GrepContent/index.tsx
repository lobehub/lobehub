'use client';

import { createGrepContentInspector } from '@lobechat/shared-tool-ui/inspectors';

export const GrepContentInspector = createGrepContentInspector({
  noResultsKey: 'builtins.lobe-cloud-sandbox.inspector.noResults',
  translationKey: 'builtins.lobe-cloud-sandbox.apiName.grepContent',
});
