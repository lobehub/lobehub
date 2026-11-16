import { useSyncExternalStore } from 'react';

import { RESERVED_ROOT_SEGMENTS } from '@/features/Workspace/rootSegments';
import { useActiveLocation } from '@/hooks/useActiveLocation';

import { useLocationOwner } from './useLocationOwner';

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

/** Origins are kept per owner (an Electron tab) and per agent / group scope. */
const originKey = (owner: string, scope: string) => `${owner}\u0000${scope}`;

/**
 * Remember where the user came from when a navigation in `owner` enters a scope.
 * Moving inside a scope (topics, sub pages) keeps its origin. Hopping from one
 * agent or group straight to another inherits the previous origin, so back
 * leaves the chat area in one click instead of bouncing between the two.
 */
export const recordBackOrigin = (owner: string, from: string | null, to: string): void => {
  if (!from) return;

  const toScope = resolveBackScope(to);
  if (!toScope) return;

  const fromScope = resolveBackScope(from);
  if (fromScope === toScope) return;

  const key = originKey(owner, toScope);
  const origin = fromScope ? origins[originKey(owner, fromScope)] : from;
  if (origins[key] === origin) return;

  const next = { ...origins };
  if (origin) next[key] = origin;
  else delete next[key];
  origins = next;
  listeners.forEach((listener) => listener());
};

/**
 * Give `toOwner` the origin `fromOwner` holds for the scope of `location`. A tab
 * duplicated into a split pane starts at the source tab's URL and should go back
 * where the source would.
 */
const copyBackOrigin = (fromOwner: string, toOwner: string, location: string): void => {
  const scope = resolveBackScope(location);
  if (!scope) return;

  const origin = origins[originKey(fromOwner, scope)];
  const key = originKey(toOwner, scope);
  if (!origin || origins[key] === origin) return;

  origins = { ...origins, [key]: origin };
  listeners.forEach((listener) => listener());
};

/**
 * Feeds locations to {@link recordBackOrigin}, keeping the previous location
 * per owner (an Electron tab), so switching tabs never reads as a navigation.
 * An owner first seen at the location the previously active owner was on is a
 * duplicate of it and inherits its origin.
 */
export const createBackOriginRecorder = () => {
  const previous = new Map<string, string>();
  let lastOwner: string | null = null;

  return (owner: string, location: string): void => {
    const from = previous.get(owner) ?? null;
    const sourceOwner = lastOwner;
    lastOwner = owner;
    if (from === location) return;

    if (from === null && sourceOwner && previous.get(sourceOwner) === location) {
      copyBackOrigin(sourceOwner, owner, location);
    } else {
      recordBackOrigin(owner, from, location);
    }
    previous.set(owner, location);
  };
};

const selectOrigin = (
  all: Readonly<Record<string, string>>,
  owner: string,
  pathname: string,
): string | undefined => {
  const scope = resolveBackScope(pathname);
  return scope ? all[originKey(owner, scope)] : undefined;
};

export const getBackOrigin = (owner: string, pathname: string): string | undefined =>
  selectOrigin(origins, owner, pathname);

/** Test-only: forget every recorded origin. */
export const resetBackOrigins = (): void => {
  origins = {};
  listeners.forEach((listener) => listener());
};

/**
 * The page the current agent / group was opened from, or `undefined`. It is the
 * literal location the user was on, so it already carries its own personal or
 * workspace scope: navigate to it as-is instead of rebasing it onto the active
 * workspace (an escaped cross-workspace link would otherwise send a personal
 * `/tasks` origin to `/<slug>/tasks`).
 */
export const useBackOrigin = (): string | undefined => {
  const { pathname } = useActiveLocation();
  const owner = useLocationOwner();
  const all = useSyncExternalStore(subscribe, getOrigins, getOrigins);

  return selectOrigin(all, owner, pathname);
};
