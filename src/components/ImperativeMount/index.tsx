'use client';

import { Fragment, memo, type ReactNode, useSyncExternalStore } from 'react';

/**
 * Imperative mounting for surfaces base-ui's modal stack doesn't cover.
 *
 * `createModal` only renders a Modal shell, so anything shaped differently — a
 * Drawer, a sheet — had no imperative entry and callers fell back to owning an
 * `open` state. That breaks down whenever the trigger lives somewhere that
 * unmounts (a dropdown popup closes and takes the drawer's state with it).
 *
 * Here the caller supplies the whole surface and only receives its open/close
 * lifecycle, so an existing self-contained component can be driven as-is.
 */
interface MountContext {
  close: () => void;
  open: boolean;
}

interface MountEntry {
  close: () => void;
  id: number;
  open: boolean;
  render: (ctx: MountContext) => ReactNode;
}

/** Grace period so the surface can play its exit transition before unmounting. */
const EXIT_GRACE_MS = 500;

let seed = 0;
let stack: MountEntry[] = [];

const listeners = new Set<() => void>();
const EMPTY: MountEntry[] = [];

const notify = () => listeners.forEach((listener) => listener());

const subscribe = (listener: () => void) => {
  listeners.add(listener);

  return () => {
    listeners.delete(listener);
  };
};

const getSnapshot = () => stack;
const getServerSnapshot = () => EMPTY;

const destroy = (id: number) => {
  const next = stack.filter((entry) => entry.id !== id);
  if (next.length === stack.length) return;

  stack = next;
  notify();
};

export const mountImperative = (render: (ctx: MountContext) => ReactNode) => {
  const id = seed++;

  const close = () => {
    let found = false;
    stack = stack.map((entry) => {
      if (entry.id !== id || !entry.open) return entry;
      found = true;
      return { ...entry, open: false };
    });
    if (!found) return;

    notify();
    setTimeout(() => destroy(id), EXIT_GRACE_MS);
  };

  stack = [...stack, { close, id, open: true, render }];
  notify();

  return { close };
};

const ImperativeMountHost = memo(() => {
  const entries = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  return (
    <>
      {entries.map((entry) => (
        <Fragment key={entry.id}>{entry.render({ close: entry.close, open: entry.open })}</Fragment>
      ))}
    </>
  );
});

ImperativeMountHost.displayName = 'ImperativeMountHost';

export default ImperativeMountHost;
