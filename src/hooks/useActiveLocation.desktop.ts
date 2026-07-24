import { useMemo } from 'react';
import { type Location } from 'react-router';

import { selectActiveTabUrl } from '@/features/Electron/shell/activeTabUrl';
import { useElectronStore } from '@/store/electron';

const parseLocation = (url: string): Location => {
  const hashIndex = url.indexOf('#');
  const hash = hashIndex === -1 ? '' : url.slice(hashIndex);
  const withoutHash = hashIndex === -1 ? url : url.slice(0, hashIndex);

  const searchIndex = withoutHash.indexOf('?');
  const search = searchIndex === -1 ? '' : withoutHash.slice(searchIndex);
  const pathname = searchIndex === -1 ? withoutHash : withoutHash.slice(0, searchIndex);

  return { hash, key: 'default', pathname: pathname || '/', search, state: null };
};

export const useActiveLocation = (): Location => {
  const url = useElectronStore(selectActiveTabUrl) ?? '/';
  return useMemo(() => parseLocation(url), [url]);
};
