'use client';

import { type DropdownItem } from '@lobehub/ui';
import { type ReactNode, type RefObject, useCallback, useEffect, useRef, useState } from 'react';

import { type LazyActions } from './useLazyActions';

export type BuildMenuItems = () => DropdownItem[];

/**
 * Defers a row's menu hook until the row is first pointed at or focused, which
 * always comes before its context menu or "more" dropdown can open.
 *
 * Row menu hooks usually reach `useNavigate` or a synced list, so a mounted one
 * re-renders its row on every navigation. Render a host component that calls
 * the menu hook only while `armed`, and have it publish its builder through
 * {@link usePublishMenuItems}.
 *
 * `items` reads that builder through a ref, so its identity never changes: a
 * fresh thunk would reach `cloneElement` inside the menu trigger and break the
 * row's memo. Menus resolve `items` when they open, so a change made while one
 * is already open shows on its next open.
 */
export const useLazyMenuItems = () => {
  const [armed, setArmed] = useState(false);
  const builderRef = useRef<BuildMenuItems | undefined>(undefined);

  const arm = useCallback(() => setArmed(true), []);
  const items = useCallback<BuildMenuItems>(() => builderRef.current?.() ?? [], []);

  /**
   * The row's NavItem `actions`: NavItem's own lazy thunk until armed, then the
   * rendered node. A row can be armed from an element NavItem never sees, such
   * as a wrapping link that takes the keyboard focus; its actions must then
   * join the tab order without waiting for NavItem's own focus or pointer.
   */
  const lazyActions = useCallback(
    (render: () => ReactNode): LazyActions => (armed ? render() : render),
    [armed],
  );

  return { arm, armed, builderRef, items, lazyActions };
};

/** Publishes the latest menu builder from a host mounted by {@link useLazyMenuItems}. */
export const usePublishMenuItems = (
  builderRef: RefObject<BuildMenuItems | undefined>,
  build: BuildMenuItems,
) => {
  useEffect(() => {
    builderRef.current = build;
  }, [build, builderRef]);
};
