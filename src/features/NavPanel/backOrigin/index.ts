import { useSyncExternalStore } from 'react';

import { RESERVED_ROOT_SEGMENTS } from '@/features/Workspace/rootSegments';
import { useActiveLocation } from '@/hooks/useActiveLocation';

import { useLocationOwner } from './useLocationOwner';

/**
 * Sidebars that own a back button for one entity (an agent or a group) send it
 * to the page the user opened that entity from, instead of always going home.
 * Opened straight from a link (nothing before it), back falls back to home.
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

/** Stacks never grow past this many entries; the oldest are dropped first. */
const MAX_STACK = 50;

/**
 * Per owner (an Electron tab, or `main` on web), the trail that led to the
 * current page: the last unscoped page, then each agent / group entered from it
 * in order, each holding the latest location seen inside it.
 */
let stacks: Readonly<Record<string, readonly string[]>> = {};
const listeners = new Set<Listener>();

const subscribe = (listener: Listener) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

const getStacks = () => stacks;

const setStack = (owner: string, stack: readonly string[]) => {
  stacks = { ...stacks, [owner]: stack.slice(-MAX_STACK) };
  listeners.forEach((listener) => listener());
};

const findScope = (stack: readonly string[], scope: string): number =>
  stack.findLastIndex((location) => resolveBackScope(location) === scope);

/**
 * Record that `owner` is now at `location`.
 *
 * - An unscoped page starts a new trail.
 * - Moving inside the current agent / group (topics, sub pages) only updates
 *   where that entry points.
 * - Entering an agent / group pushes it, so back steps out one level at a time
 *   (page → agent → group goes back to the agent, then to the page).
 * - Re-entering one already on the trail cuts the trail back to it, so hopping
 *   A → B → A and pressing back leaves for the page A was opened from instead
 *   of bouncing between A and B.
 */
export const recordBackLocation = (owner: string, location: string): void => {
  const stack = stacks[owner] ?? [];
  if (stack.at(-1) === location) return;

  const scope = resolveBackScope(location);
  if (!scope) return setStack(owner, [location]);

  const index = findScope(stack, scope);
  setStack(owner, index === -1 ? [...stack, location] : [...stack.slice(0, index), location]);
};

/**
 * Feeds locations to {@link recordBackLocation}. Switching to another owner is
 * not a navigation: each owner keeps its own trail. An owner first seen at the
 * location the previously active owner was on is a duplicate of it (a tab split
 * into a new pane) and starts from a copy of its trail.
 */
export const createBackOriginRecorder = () => {
  let lastOwner: string | null = null;

  return (owner: string, location: string): void => {
    const sourceOwner = lastOwner;
    lastOwner = owner;

    const source = sourceOwner ? stacks[sourceOwner] : undefined;
    if (!stacks[owner] && source?.at(-1) === location) {
      setStack(owner, source);
      return;
    }
    recordBackLocation(owner, location);
  };
};

const selectOrigin = (
  all: Readonly<Record<string, readonly string[]>>,
  owner: string,
  pathname: string,
): string | undefined => {
  const scope = resolveBackScope(pathname);
  const stack = all[owner];
  if (!scope || !stack) return undefined;

  const index = findScope(stack, scope);
  return index > 0 ? stack[index - 1] : undefined;
};

export const getBackOrigin = (owner: string, pathname: string): string | undefined =>
  selectOrigin(stacks, owner, pathname);

/** Test-only: forget every recorded trail. */
export const resetBackOrigins = (): void => {
  stacks = {};
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
  const all = useSyncExternalStore(subscribe, getStacks, getStacks);

  return selectOrigin(all, owner, pathname);
};
