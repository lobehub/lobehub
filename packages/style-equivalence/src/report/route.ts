import { useSyncExternalStore } from 'react';

export type Route =
  | { kind: 'case'; key: string }
  | { kind: 'file'; file: string }
  | { kind: 'method' }
  | { kind: 'overview' }
  | { kind: 'signoff' };

export const parseRoute = (hash: string): Route => {
  const [, kind, ...rest] = hash.replace(/^#/, '').split('/');
  const value = decodeURIComponent(rest.join('/'));
  if (kind === 'file' && value) return { file: value, kind: 'file' };
  if (kind === 'case' && value) return { key: value, kind: 'case' };
  if (kind === 'method') return { kind: 'method' };
  if (kind === 'signoff') return { kind: 'signoff' };
  return { kind: 'overview' };
};

export const hrefOf = (route: Route) => {
  if (route.kind === 'file') return `#/file/${encodeURIComponent(route.file)}`;
  if (route.kind === 'case') return `#/case/${encodeURIComponent(route.key)}`;
  if (route.kind === 'overview') return '#/';
  return `#/${route.kind}`;
};

const subscribe = (listener: () => void) => {
  window.addEventListener('hashchange', listener);
  return () => window.removeEventListener('hashchange', listener);
};

export const useRoute = () => parseRoute(useSyncExternalStore(subscribe, () => location.hash));
