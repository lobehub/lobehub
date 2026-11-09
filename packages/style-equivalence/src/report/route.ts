import { useSyncExternalStore } from 'react';

export type Route =
  | { kind: 'case'; key: string }
  | { kind: 'file'; file: string }
  | { anchor?: string; kind: 'method' }
  | { kind: 'overview' }
  | { key?: string; kind: 'review' };

export const parseRoute = (hash: string): Route => {
  const [path, anchor] = hash.replace(/^#/, '').split('#');
  const [, kind, ...rest] = path.split('/');
  const value = decodeURIComponent(rest.join('/'));
  if (kind === 'file' && value) return { file: value, kind: 'file' };
  if (kind === 'case' && value) return { key: value, kind: 'case' };
  if (kind === 'method') return anchor ? { anchor, kind: 'method' } : { kind: 'method' };
  if (kind === 'review' && value) return { key: value, kind: 'review' };
  if (kind === 'review' || kind === 'signoff') return { kind: 'review' };
  return { kind: 'overview' };
};

export const hrefOf = (route: Route) => {
  if (route.kind === 'file') return `#/file/${encodeURIComponent(route.file)}`;
  if (route.kind === 'case') return `#/case/${encodeURIComponent(route.key)}`;
  if (route.kind === 'review' && route.key) return `#/review/${encodeURIComponent(route.key)}`;
  if (route.kind === 'overview') return '#/';
  if (route.kind === 'method' && route.anchor) return `#/method#${route.anchor}`;
  return `#/${route.kind}`;
};

const subscribe = (listener: () => void) => {
  window.addEventListener('hashchange', listener);
  return () => window.removeEventListener('hashchange', listener);
};

export const useRoute = () => parseRoute(useSyncExternalStore(subscribe, () => location.hash));
