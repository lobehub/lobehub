import { type MouseEvent, useSyncExternalStore } from 'react';

import { RESERVED_ROOT_SEGMENTS } from '@/features/Workspace/rootSegments';
import { useActiveLocation } from '@/hooks/useActiveLocation';

import { readHistoryIndex } from './historyIndex';
import { MAIN_OWNER, type OpenOwners, useLocationOwner } from './useLocationOwner';

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

/** One step of a trail: where the user was, and its browser history index when known. */
export interface BackEntry {
  /** `history.state.idx` of that location on web; unknown on desktop tabs. */
  historyIndex?: number;
  location: string;
}

type Stacks = Readonly<Record<string, readonly BackEntry[]>>;

/** Stacks never grow past this many entries; the oldest are dropped first. */
const MAX_STACK = 50;

/**
 * Per owner (an Electron tab, or `main` on web), the trail that led to the
 * current page: the last unscoped page, then each agent / group entered from it
 * in order, each holding the latest location seen inside it.
 */
let stacks: Stacks = {};
const listeners = new Set<Listener>();

const subscribe = (listener: Listener) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

const getStacks = () => stacks;

const setStack = (owner: string, stack: readonly BackEntry[]) => {
  stacks = { ...stacks, [owner]: stack.slice(-MAX_STACK) };
  listeners.forEach((listener) => listener());
};

/**
 * Forget the trails of owners that were closed (Electron tabs). `main` (the web
 * router, or desktop without tabs) is always kept.
 */
export const pruneBackOwners = (closedOwners: Iterable<string>): void => {
  const closed = new Set(closedOwners);
  closed.delete(MAIN_OWNER);
  if (![...closed].some((owner) => owner in stacks)) return;

  stacks = Object.fromEntries(Object.entries(stacks).filter(([owner]) => !closed.has(owner)));
  listeners.forEach((listener) => listener());
};

/**
 * The owners closed between two snapshots of the open owners. A snapshot taken
 * in another scope (personal vs a workspace) lists that scope's tabs instead, so
 * a scope switch closes nothing: those tabs come back when the user returns.
 */
export const closedOwnersBetween = (
  previous: OpenOwners | null,
  next: OpenOwners | null,
): string[] => {
  if (!previous || !next || previous.scope !== next.scope) return [];
  const open = new Set(next.ids);
  return previous.ids.filter((id) => !open.has(id));
};

const findScope = (stack: readonly BackEntry[], scope: string): number =>
  stack.findLastIndex((entry) => resolveBackScope(entry.location) === scope);

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
export const recordBackLocation = (
  owner: string,
  location: string,
  historyIndex?: number,
): void => {
  const stack = stacks[owner] ?? [];
  const top = stack.at(-1);
  if (top?.location === location && top.historyIndex === historyIndex) return;

  const entry: BackEntry = { historyIndex, location };
  const scope = resolveBackScope(location);
  if (!scope) return setStack(owner, [entry]);

  const index = findScope(stack, scope);
  setStack(owner, index === -1 ? [...stack, entry] : [...stack.slice(0, index), entry]);
};

/**
 * Feeds locations to {@link recordBackLocation}. Switching to another owner is
 * not a navigation: each owner keeps its own trail. An owner first seen at the
 * location the previously active owner was on is a duplicate of it (a tab split
 * into a new pane) and starts from a copy of its trail.
 */
export const createBackOriginRecorder = () => {
  let lastOwner: string | null = null;

  return (owner: string, location: string, historyIndex?: number): void => {
    const sourceOwner = lastOwner;
    lastOwner = owner;

    const source = sourceOwner ? stacks[sourceOwner] : undefined;
    if (!stacks[owner] && source?.at(-1)?.location === location) {
      setStack(owner, source);
      return;
    }
    recordBackLocation(owner, location, historyIndex);
  };
};

const selectOrigin = (all: Stacks, owner: string, pathname: string): BackEntry | undefined => {
  const scope = resolveBackScope(pathname);
  const stack = all[owner];
  if (!scope || !stack) return undefined;

  const index = findScope(stack, scope);
  return index > 0 ? stack[index - 1] : undefined;
};

export const getBackOrigin = (owner: string, pathname: string): string | undefined =>
  selectOrigin(stacks, owner, pathname)?.location;

/**
 * How many browser history steps lead back to `origin`, or `undefined` when it
 * is not an earlier entry of the current history (desktop tabs, a `replace`
 * into the agent, a reload that lost the index).
 */
export const historyDeltaTo = (
  origin: BackEntry,
  currentIndex: number | undefined,
): number | undefined => {
  if (origin.historyIndex === undefined || currentIndex === undefined) return undefined;
  const delta = origin.historyIndex - currentIndex;
  return delta < 0 ? delta : undefined;
};

/** Test-only: forget every recorded trail. */
export const resetBackOrigins = (): void => {
  stacks = {};
  listeners.forEach((listener) => listener());
};

/**
 * Back button props for the agent / group sidebar header.
 *
 * The origin is the literal location the user was on, so it already carries its
 * own personal or workspace scope: it is navigated to as-is instead of being
 * rebased onto the active workspace (an escaped cross-workspace link would
 * otherwise send a personal `/tasks` origin to `/<slug>/tasks`).
 *
 * When the origin is still an earlier entry of the browser history, a plain
 * click walks the history back to it instead of pushing it again, so the
 * browser back button and the in-page one stay in step. Without an origin
 * (opened straight from a link) back goes home.
 */
export const useBackButtonProps = (): {
  backEscape: boolean;
  backTo: string;
  onBack?: (event: MouseEvent) => void;
} => {
  const { pathname } = useActiveLocation();
  const owner = useLocationOwner();
  const all = useSyncExternalStore(subscribe, getStacks, getStacks);
  const origin = selectOrigin(all, owner, pathname);

  if (!origin) return { backEscape: false, backTo: '/' };

  return {
    backEscape: true,
    backTo: origin.location,
    onBack: (event) => {
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0)
        return;
      const delta = historyDeltaTo(origin, readHistoryIndex());
      if (delta === undefined) return;
      event.preventDefault();
      window.history.go(delta);
    },
  };
};
