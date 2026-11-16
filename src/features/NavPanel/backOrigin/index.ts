import { useSyncExternalStore } from 'react';

import { RESERVED_ROOT_SEGMENTS } from '@/features/Workspace/rootSegments';
import { useActiveLocation } from '@/hooks/useActiveLocation';

/**
 * Sidebars that own a back button for one entity (an agent or a group) send it
 * to the page the user opened that entity from, instead of always going home.
 */
const SCOPED_ROOT_SEGMENTS: ReadonlySet<string> = new Set(['agent', 'group']);

/**
 * The entity a path belongs to (`agent:<id>` / `group:<id>`), with an optional
 * `/:workspaceSlug` prefix stripped. Any other page has no scope.
 */
export const resolveBackScope = (pathname: string): string | null => {
  const segments = pathname.split(/[?#]/)[0].split('/').filter(Boolean);
  const routeSegments =
    segments.length > 0 && !RESERVED_ROOT_SEGMENTS.has(segments[0]) ? segments.slice(1) : segments;
  const [root, id] = routeSegments;

  if (!root || !id || !SCOPED_ROOT_SEGMENTS.has(root)) return null;
  return `${root}:${id}`;
};

type Listener = () => void;

let origins: Readonly<Record<string, string>> = {};
const listeners = new Set<Listener>();

const subscribe = (listener: Listener) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

const getOrigins = () => origins;

/**
 * Remember where the user came from when a navigation enters a scope. Moving
 * inside a scope (topics, sub pages) keeps its origin. Hopping from one agent or
 * group straight to another inherits the previous origin, so back leaves the
 * chat area in one click instead of bouncing between the two.
 */
export const recordBackOrigin = (from: string | null, to: string): void => {
  if (!from) return;

  const toScope = resolveBackScope(to);
  if (!toScope) return;

  const fromScope = resolveBackScope(from);
  if (fromScope === toScope) return;

  const origin = fromScope ? origins[fromScope] : from;
  if (origins[toScope] === origin) return;

  const next = { ...origins };
  if (origin) next[toScope] = origin;
  else delete next[toScope];
  origins = next;
  listeners.forEach((listener) => listener());
};

/**
 * Feeds locations to {@link recordBackOrigin}, keeping the previous location
 * per owner (an Electron tab), so switching tabs never reads as a navigation.
 */
export const createBackOriginRecorder = () => {
  const previous = new Map<string, string>();

  return (owner: string, location: string): void => {
    const from = previous.get(owner) ?? null;
    if (from === location) return;

    recordBackOrigin(from, location);
    previous.set(owner, location);
  };
};

export const getBackOrigin = (pathname: string): string | undefined => {
  const scope = resolveBackScope(pathname);
  return scope ? origins[scope] : undefined;
};

/** Test-only: forget every recorded origin. */
export const resetBackOrigins = (): void => {
  origins = {};
  listeners.forEach((listener) => listener());
};

/** Where the current agent / group sidebar's back button goes; `fallback` without an origin. */
export const useBackOrigin = (fallback = '/'): string => {
  const { pathname } = useActiveLocation();
  const all = useSyncExternalStore(subscribe, getOrigins, getOrigins);
  const scope = resolveBackScope(pathname);

  return (scope && all[scope]) || fallback;
};
