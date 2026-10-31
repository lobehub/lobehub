import type { RouteObject } from 'react-router';
import { describe, expect, it } from 'vitest';

import { dropRoute, overlayRoutes, withHandle } from './routeOverlay';

const tree: RouteObject[] = [
  {
    children: [{ handle: { meta: 'docs' }, index: true }, { path: ':docId' }],
    path: 'docs',
  },
  // Pathless layout: its children keep the parent's base.
  { children: [{ path: 'goals' }, { path: 'task/:taskId' }] },
];

describe('overlayRoutes', () => {
  it('adjusts routes by their path from the tree root, index routes as <parent>/index', () => {
    const result = overlayRoutes(tree, {
      'docs/index': withHandle({ mobileShellHeader: true }),
      'task/:taskId': dropRoute,
    });

    expect(result[0].children?.[0].handle).toEqual({ meta: 'docs', mobileShellHeader: true });
    expect(result[1].children?.map((route) => route.path)).toEqual(['goals']);
  });

  it('returns the source routes untouched without overlays', () => {
    const result = overlayRoutes(tree, {});

    expect(result).toEqual(tree);
    expect(result[0].children?.[1]).toBe(tree[0].children?.[1]);
  });

  it('throws when a key matches no route, so a renamed source route cannot slip past', () => {
    expect(() => overlayRoutes(tree, { 'docs/:id': dropRoute })).toThrow('docs/:id');
  });
});
