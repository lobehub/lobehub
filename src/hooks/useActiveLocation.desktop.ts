import { useMemo } from 'react';
import { type Location } from 'react-router';

import { selectActiveTabUrl } from '@/features/Electron/shell/activeTabUrl';
import { useElectronStore } from '@/store/electron';

// Tab urls only ever carry pathname+search: `TabLocationReporter` and the
// eviction snapshot both persist `pathname + search`, never a hash. Drop any
// stray hash so this mirror stays aligned with what the store holds.
const parseLocation = (url: string): Location => {
  const withoutHash = url.split('#')[0];

  const searchIndex = withoutHash.indexOf('?');
  const search = searchIndex === -1 ? '' : withoutHash.slice(searchIndex);
  const pathname = searchIndex === -1 ? withoutHash : withoutHash.slice(0, searchIndex);

  return { hash: '', key: 'default', pathname: pathname || '/', search, state: null };
};

export const useActiveLocation = (): Location => {
  const url = useElectronStore(selectActiveTabUrl) ?? '/';
  return useMemo(() => parseLocation(url), [url]);
};
