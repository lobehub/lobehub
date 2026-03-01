import { useEffect, useState } from 'react';

export const FILE_MODAL_QUERY_KEY = 'files';
const FILE_MODAL_QUERY_EVENT = 'lobe-files-querychange';

const getCurrentSearch = () => {
  if (typeof window === 'undefined') return '';
  return window.location.search;
};

export const getCurrentFileModalId = () => {
  const search = getCurrentSearch();
  if (!search) return undefined;

  const params = new URLSearchParams(search);
  return params.get(FILE_MODAL_QUERY_KEY) ?? undefined;
};

const pushStateWithParams = (params: URLSearchParams) => {
  if (typeof window === 'undefined') return;

  const search = params.toString();
  const hash = window.location.hash;
  const pathname = window.location.pathname;
  const url = `${pathname}${search ? `?${search}` : ''}${hash}`;

  window.history.pushState({}, '', url);
  window.dispatchEvent(new Event(FILE_MODAL_QUERY_EVENT));
};

export const setFileModalId = (id?: string) => {
  if (typeof window === 'undefined') return;

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
    if (typeof window === 'undefined') return;

    const handler = () => {
      setFileId(getCurrentFileModalId());
    };

    window.addEventListener('popstate', handler);
    window.addEventListener(FILE_MODAL_QUERY_EVENT, handler);

    return () => {
      window.removeEventListener('popstate', handler);
      window.removeEventListener(FILE_MODAL_QUERY_EVENT, handler);
    };
  }, []);

  return fileId;
};
