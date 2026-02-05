import { useEffect, useState } from 'react';

export const FILE_MODAL_QUERY_KEY = 'files';
const FILE_MODAL_QUERY_EVENT = 'lobe-files-querychange';

const getCurrentSearch = () => {
  if (typeof globalThis.window === 'undefined') return '';
  return globalThis.location.search;
};

export const getCurrentFileModalId = () => {
  const search = getCurrentSearch();
  if (!search) return undefined;

  const params = new URLSearchParams(search);
  return params.get(FILE_MODAL_QUERY_KEY) ?? undefined;
};

const pushStateWithParams = (params: URLSearchParams) => {
  if (typeof globalThis.window === 'undefined') return;

  const search = params.toString();
  const hash = globalThis.location.hash;
  const pathname = globalThis.location.pathname;
  const url = `${pathname}${search ? `?${search}` : ''}${hash}`;

  globalThis.history.pushState({}, '', url);
  globalThis.dispatchEvent(new Event(FILE_MODAL_QUERY_EVENT));
};

export const setFileModalId = (id?: string) => {
  if (typeof globalThis.window === 'undefined') return;

  const params = new URLSearchParams(getCurrentSearch());

  if (!id) {
    params.delete(FILE_MODAL_QUERY_KEY);
  } else {
    params.set(FILE_MODAL_QUERY_KEY, id);
  }

  pushStateWithParams(params);
};

export const useFileModalId = (): string | undefined => {
  const [fileId, setFileId] = useState<string | undefined>(() => getCurrentFileModalId());

  useEffect(() => {
    if (typeof globalThis.window === 'undefined') return;

    const handler = () => {
      setFileId(getCurrentFileModalId());
    };

    globalThis.addEventListener('popstate', handler);
    globalThis.addEventListener(FILE_MODAL_QUERY_EVENT, handler);

    return () => {
      globalThis.removeEventListener('popstate', handler);
      globalThis.removeEventListener(FILE_MODAL_QUERY_EVENT, handler);
    };
  }, []);

  return fileId;
};
