import { describe, expect, it } from 'vitest';

import {
  beginAnnotationScrollSync,
  collectAnchoredAnnotationMeasurements,
  consumeAnnotationRailNavigation,
  findAnnotationGroupItem,
  finishAnnotationScrollSync,
  getAnnotationRailScrollTarget,
  groupAnnotationMeasurements,
  initialAnnotationRailNavigationState,
  initialAnnotationScrollGuardState,
  layoutAnnotationRailItems,
  prepareAnnotationRailNavigation,
  resolveAnnotationGroupExpansion,
  resolveComposerAnchorY,
  shouldAutoExpandGroup,
  shouldIgnoreAnnotationScroll,
} from './annotationRail';

const annotation = (
  id: string,
  anchorY: number,
  createdAt = `2026-01-01T00:00:00.000Z-${id}`,
  _nodeKeys?: string[],
  anchorGroupKey?: string,
) => ({
  anchorGroupKey,
  anchorY,
  createdAt,
  id,
  record: { id } as any,
});

const record = (id: string, status: 'active' | 'resolved' | 'orphaned' = 'active') =>
  ({
    createdAt: `2026-01-01T00:00:00.000Z-${id}`,
    id,
    kind: 'comment',
    payload: null,
    quotedText: id,
    status,
    updatedAt: `2026-01-01T00:00:00.000Z-${id}`,
  }) as any;

describe('annotation rail anchor filtering', () => {
  it('hides orphaned and unmeasurable comments instead of assigning a viewport/top anchor', () => {
    const records = [record('deleted', 'orphaned'), record('missing'), record('live')];
    const measurements = collectAnchoredAnnotationMeasurements(
      records,
      (current) => (current.id === 'live' ? ({ anchorY: 480 } as any) : null),
      { anchorOffset: 20 },
    );

    expect(measurements.map((measurement) => measurement.id)).toEqual(['live']);
    expect(measurements[0].anchorY).toBe(500);
    expect(measurements.some((measurement) => measurement.anchorY === 0)).toBe(false);
  });

  it('reintroduces a comment once undo restores its active DOM anchor', () => {
    const orphaned = collectAnchoredAnnotationMeasurements(
      [record('undo-comment', 'orphaned')],
      () => ({ anchorY: 240 }) as any,
    );
    const restored = collectAnchoredAnnotationMeasurements(
      [record('undo-comment', 'active')],
      () => ({ anchorY: 240 }) as any,
    );

    expect(orphaned).toEqual([]);
    expect(restored.map((measurement) => measurement.id)).toEqual(['undo-comment']);
  });

  it('defensively excludes orphaned records passed directly to spatial grouping', () => {
    const groups = groupAnnotationMeasurements([
      { ...annotation('deleted', 0), record: record('deleted', 'orphaned') },
      { ...annotation('live', 120), record: record('live') },
    ]);

    expect(groups.flatMap((group) => group.items.map((item) => item.id))).toEqual(['live']);
  });

  it('does not create a navigation target for an orphaned annotation', () => {
    const item = {
      anchorY: 0,
      createdAt: '1',
      group: {
        anchorY: 0,
        createdAt: '1',
        id: 'annotation-group:deleted',
        items: [{ ...annotation('deleted', 0), record: record('deleted', 'orphaned') }],
      },
      height: 104,
      id: 'annotation-group:deleted',
      kind: 'annotation' as const,
      y: 0,
    };

    expect(findAnnotationGroupItem([item], 'deleted')).toBeNull();
  });
});

describe('annotation rail grouping', () => {
  it('epsilon-groups nearby anchors and preserves deterministic createdAt/id order', () => {
    const groups = groupAnnotationMeasurements(
      [
        annotation('b', 104, '2026-01-01T00:00:02.000Z'),
        annotation('a', 100, '2026-01-01T00:00:01.000Z'),
        annotation('far', 160, '2026-01-01T00:00:00.000Z'),
      ],
      8,
    );

    expect(groups).toHaveLength(2);
    expect(groups[0].anchorY).toBe(100);
    expect(groups[0].items.map((item) => item.id)).toEqual(['a', 'b']);
    expect(groups[1].items.map((item) => item.id)).toEqual(['far']);
  });

  it('keeps a sorted epsilon chain in one cluster instead of comparing only to its minimum', () => {
    const groups = groupAnnotationMeasurements(
      [
        annotation('zero', 0, '2026-01-01T00:00:00.000Z'),
        annotation('ten', 10, '2026-01-01T00:00:01.000Z'),
        annotation('twenty', 20, '2026-01-01T00:00:02.000Z'),
      ],
      12,
    );

    expect(groups).toHaveLength(1);
    expect(groups[0].items.map((item) => item.id)).toEqual(['zero', 'ten', 'twenty']);
  });

  it('ignores stale record node keys when grouping runtime DOM anchors', () => {
    const groups = groupAnnotationMeasurements(
      [
        annotation('first', 40, '2026-01-01T00:00:01.000Z', ['node-1']),
        annotation('unrelated', 80, '2026-01-01T00:00:00.000Z', ['node-2']),
        annotation('same-node', 180, '2026-01-01T00:00:02.000Z', ['node-1']),
      ],
      4,
    );

    expect(groups.map((group) => group.items.map((item) => item.id))).toEqual([
      ['first'],
      ['unrelated'],
      ['same-node'],
    ]);
  });

  it('groups split range annotations by semantic block before node keys or geometry', () => {
    const groups = groupAnnotationMeasurements(
      [
        annotation('first-split', 40, '2026-01-01T00:00:01.000Z', ['text-a'], 'root-1:block-1'),
        annotation('second-split', 220, '2026-01-01T00:00:02.000Z', ['text-b'], 'root-1:block-1'),
      ],
      4,
    );

    expect(groups).toHaveLength(1);
    expect(groups[0].items.map((item) => item.id)).toEqual(['first-split', 'second-split']);
    expect(groups[0].id).toBe('annotation-group:key:root-1%3Ablock-1');
  });

  it('keeps adjacent semantic blocks separate even when their anchors are close', () => {
    const groups = groupAnnotationMeasurements(
      [
        annotation('block-a', 100, '2026-01-01T00:00:01.000Z', ['text-a'], 'root-1:block-a'),
        annotation('block-b', 104, '2026-01-01T00:00:00.000Z', ['text-b'], 'root-1:block-b'),
      ],
      16,
    );

    expect(groups.map((group) => group.items.map((item) => item.id))).toEqual([
      ['block-a'],
      ['block-b'],
    ]);
  });

  it('keeps semantic group ids stable when an earlier annotation is added', () => {
    const initial = groupAnnotationMeasurements(
      [
        annotation('existing-a', 100, '2026-01-01T00:00:02.000Z', ['text-a'], 'root-1:block-a'),
        annotation('existing-b', 104, '2026-01-01T00:00:03.000Z', ['text-b'], 'root-1:block-a'),
      ],
      16,
    );
    const withEarlier = groupAnnotationMeasurements(
      [
        annotation('earlier', 100, '2026-01-01T00:00:00.000Z', ['text-c'], 'root-1:block-a'),
        annotation('existing-a', 100, '2026-01-01T00:00:02.000Z', ['text-a'], 'root-1:block-a'),
        annotation('existing-b', 104, '2026-01-01T00:00:03.000Z', ['text-b'], 'root-1:block-a'),
      ],
      16,
    );

    expect(withEarlier[0].id).toBe(initial[0].id);
  });

  it('uses a quantized coordinate id for keyless epsilon fallback groups', () => {
    const initial = groupAnnotationMeasurements(
      [
        annotation('existing-a', 100, '2026-01-01T00:00:02.000Z'),
        annotation('existing-b', 104, '2026-01-01T00:00:03.000Z'),
      ],
      16,
    );
    const withEarlier = groupAnnotationMeasurements(
      [
        annotation('earlier', 100, '2026-01-01T00:00:00.000Z'),
        annotation('existing-a', 100, '2026-01-01T00:00:02.000Z'),
        annotation('existing-b', 104, '2026-01-01T00:00:03.000Z'),
      ],
      16,
    );

    expect(withEarlier[0].id).toBe(initial[0].id);
    expect(withEarlier[0].items.map((item) => item.id)).toEqual([
      'earlier',
      'existing-a',
      'existing-b',
    ]);
  });

  it('keeps keyless anchors available for epsilon chain grouping', () => {
    const groups = groupAnnotationMeasurements(
      [annotation('zero', 0, '1'), annotation('ten', 10, '2'), annotation('twenty', 20, '3')],
      12,
    );

    expect(groups).toHaveLength(1);
  });
});

describe('annotation rail navigation', () => {
  it('finds the group containing a requested annotation id', () => {
    const item = {
      anchorY: 20,
      createdAt: '1',
      group: {
        anchorY: 20,
        createdAt: '1',
        id: 'annotation-group:first',
        items: [annotation('first', 20, '1'), annotation('second', 22, '2')],
      },
      height: 104,
      id: 'annotation-group:first',
      kind: 'annotation' as const,
      y: 40,
    };

    expect(findAnnotationGroupItem([item], 'second')).toBe(item);
    expect(findAnnotationGroupItem([item], 'missing')).toBeNull();
  });

  it('centers a group and clamps the rail scroll target to its bounds', () => {
    expect(
      getAnnotationRailScrollTarget({
        groupHeight: 100,
        groupY: 500,
        maxScrollTop: 1_000,
        viewportHeight: 300,
      }),
    ).toBe(400);
    expect(
      getAnnotationRailScrollTarget({
        groupHeight: 100,
        groupY: 20,
        maxScrollTop: 1_000,
        viewportHeight: 300,
      }),
    ).toBe(0);
    expect(
      getAnnotationRailScrollTarget({
        groupHeight: 100,
        groupY: 990,
        maxScrollTop: 500,
        viewportHeight: 300,
      }),
    ).toBe(500);
  });

  it('keeps a request pending until the target group is expanded and mounted', () => {
    const request = { annotationId: 'first', token: 1 };
    const collapsed = {
      id: 'annotation-group:first',
      kind: 'annotation' as const,
      expanded: false,
    };
    const prepared = prepareAnnotationRailNavigation(
      initialAnnotationRailNavigationState,
      request,
      collapsed,
    );

    expect(prepared.selectedGroupId).toBe(collapsed.id);
    expect(prepared.expandGroupId).toBe(collapsed.id);
    expect(
      consumeAnnotationRailNavigation(prepared.state, request, collapsed, true).shouldScroll,
    ).toBe(false);
    expect(
      consumeAnnotationRailNavigation(
        prepared.state,
        request,
        { ...collapsed, expanded: true },
        false,
      ).shouldScroll,
    ).toBe(false);
  });

  it('retains an unresolved token until a later snapshot locates its annotation', () => {
    const request = { annotationId: 'later', token: 1 };
    const pending = prepareAnnotationRailNavigation(
      initialAnnotationRailNavigationState,
      request,
      null,
    );
    expect(pending.state.pending).toEqual({
      annotationId: 'later',
      groupId: null,
      token: 1,
    });
    expect(consumeAnnotationRailNavigation(pending.state, request, null, true).shouldScroll).toBe(
      false,
    );

    const target = {
      id: 'annotation-group:later',
      kind: 'annotation' as const,
      expanded: true,
    };
    const resolved = prepareAnnotationRailNavigation(pending.state, request, target);
    expect(resolved.state.pending?.groupId).toBe(target.id);
    expect(
      consumeAnnotationRailNavigation(resolved.state, request, target, true).shouldScroll,
    ).toBe(true);
  });

  it('consumes one token once and ignores later snapshot updates', () => {
    const request = { annotationId: 'first', token: 1 };
    const target = {
      id: 'annotation-group:first',
      kind: 'annotation' as const,
      expanded: true,
    };
    const prepared = prepareAnnotationRailNavigation(
      initialAnnotationRailNavigationState,
      request,
      target,
    );
    const consumed = consumeAnnotationRailNavigation(prepared.state, request, target, true);

    expect(consumed.shouldScroll).toBe(true);
    expect(
      consumeAnnotationRailNavigation(consumed.state, request, target, true).shouldScroll,
    ).toBe(false);
    expect(prepareAnnotationRailNavigation(consumed.state, request, target).state).toEqual(
      consumed.state,
    );
  });

  it('allows a new token for the same annotation to navigate again', () => {
    const target = {
      id: 'annotation-group:first',
      kind: 'annotation' as const,
      expanded: true,
    };
    const firstRequest = { annotationId: 'first', token: 1 };
    const firstPrepared = prepareAnnotationRailNavigation(
      initialAnnotationRailNavigationState,
      firstRequest,
      target,
    );
    const firstConsumed = consumeAnnotationRailNavigation(
      firstPrepared.state,
      firstRequest,
      target,
      true,
    );
    const secondRequest = { annotationId: 'first', token: 2 };
    const secondPrepared = prepareAnnotationRailNavigation(
      firstConsumed.state,
      secondRequest,
      target,
    );

    expect(
      consumeAnnotationRailNavigation(secondPrepared.state, secondRequest, target, true)
        .shouldScroll,
    ).toBe(true);
  });
});

describe('annotation rail VPSC/PAVA layout', () => {
  it('solves dense anchors globally with different heights and no overlap', () => {
    const result = layoutAnnotationRailItems(
      [
        { anchorY: 20, createdAt: '1', height: 52, id: 'a', kind: 'annotation' },
        { anchorY: 28, createdAt: '2', height: 24, id: 'b', kind: 'annotation' },
        { anchorY: 31, createdAt: '3', height: 70, id: 'c', kind: 'annotation' },
      ],
      { documentHeight: 220, gap: 10 },
    );

    expect(result.items.map((item) => item.id)).toEqual(['a', 'b', 'c']);
    for (let index = 1; index < result.items.length; index++) {
      const previous = result.items[index - 1];
      const current = result.items[index];
      expect(current.y).toBeGreaterThanOrEqual(previous.y + previous.height + 10);
    }
    expect(result.items[0].y).toBeGreaterThanOrEqual(0);
    expect(result.height).toBe(220);
  });

  it('extends the rail document when cards exceed the current document height', () => {
    const result = layoutAnnotationRailItems(
      [
        { anchorY: 0, createdAt: '1', height: 100, id: 'a', kind: 'annotation' },
        { anchorY: 4, createdAt: '2', height: 80, id: 'b', kind: 'annotation' },
      ],
      { documentHeight: 20, gap: 12 },
    );

    expect(result.height).toBe(192);
    expect(result.items[1].y).toBeGreaterThanOrEqual(112);
  });

  it('keeps equal-anchor order stable by createdAt', () => {
    const result = layoutAnnotationRailItems(
      [
        { anchorY: 50, createdAt: '2026-01-02', height: 10, id: 'later', kind: 'annotation' },
        { anchorY: 50, createdAt: '2026-01-01', height: 10, id: 'earlier', kind: 'annotation' },
      ],
      { documentHeight: 100, gap: 4 },
    );

    expect(result.items.map((item) => item.id)).toEqual(['earlier', 'later']);
  });
});

describe('annotation rail automatic expansion', () => {
  it('expands the last group when the expanded card fits below it', () => {
    expect(
      shouldAutoExpandGroup({
        documentHeight: 320,
        expandedHeight: 120,
        gap: 12,
        groupY: 160,
      }),
    ).toBe(true);
  });

  it('expands when there is enough space before the next layout item', () => {
    expect(
      shouldAutoExpandGroup({
        documentHeight: 400,
        expandedHeight: 100,
        gap: 12,
        groupY: 80,
        nextY: 200,
      }),
    ).toBe(true);
  });

  it('keeps a dense group collapsed when the expanded card collides', () => {
    expect(
      shouldAutoExpandGroup({
        documentHeight: 400,
        expandedHeight: 130,
        gap: 12,
        groupY: 80,
        nextY: 200,
      }),
    ).toBe(false);
  });

  it('treats a composer below the group as the next collision boundary', () => {
    expect(
      shouldAutoExpandGroup({
        documentHeight: 800,
        expandedHeight: 180,
        gap: 12,
        groupY: 120,
        nextY: 300,
      }),
    ).toBe(false);
  });

  it('does not expand past the rail document boundary', () => {
    expect(
      shouldAutoExpandGroup({
        documentHeight: 240,
        expandedHeight: 100,
        groupY: 160,
      }),
    ).toBe(false);
  });

  it('keeps manual expand/collapse choices above automatic geometry', () => {
    expect(resolveAnnotationGroupExpansion(true, false)).toBe(false);
    expect(resolveAnnotationGroupExpansion(false, true)).toBe(true);
    expect(resolveAnnotationGroupExpansion(true)).toBe(true);
  });
});

describe('annotation rail composer anchor resolution', () => {
  it('prefers native range geometry over saved node geometry', () => {
    expect(resolveComposerAnchorY({ nativeRectY: 120, nodeAnchorY: 480, viewportY: 800 })).toBe(
      120,
    );
  });

  it('uses saved node geometry when native range geometry is unavailable', () => {
    expect(resolveComposerAnchorY({ nativeRectY: null, nodeAnchorY: 480, viewportY: 800 })).toBe(
      480,
    );
  });

  it('uses the current scroll viewport rather than the canvas origin as the last fallback', () => {
    expect(resolveComposerAnchorY({ nativeRectY: null, nodeAnchorY: null, viewportY: 800 })).toBe(
      800,
    );
  });
});

describe('annotation rail scroll guard', () => {
  it('ignores the programmatic target event for both editor-to-rail and rail-to-editor sync', () => {
    // User scrolls the editor; the handler writes rail.scrollTop, so the next rail event is ours.
    const editorEvent = beginAnnotationScrollSync(initialAnnotationScrollGuardState, 'rail');
    expect(shouldIgnoreAnnotationScroll(editorEvent, 'rail')).toBe(true);
    expect(shouldIgnoreAnnotationScroll(editorEvent, 'editor')).toBe(false);

    // User scrolls the rail; the handler writes editor.scrollTop, so the next editor event is ours.
    const railEvent = beginAnnotationScrollSync(editorEvent, 'editor');
    expect(shouldIgnoreAnnotationScroll(railEvent, 'editor')).toBe(true);
    expect(shouldIgnoreAnnotationScroll(railEvent, 'rail')).toBe(false);
  });

  it('keeps the newest rapid-sync token authoritative', () => {
    const first = beginAnnotationScrollSync(initialAnnotationScrollGuardState, 'rail');
    const second = beginAnnotationScrollSync(first, 'editor');

    expect(finishAnnotationScrollSync(second, first.token).activeSource).toBe('editor');
    expect(finishAnnotationScrollSync(second, second.token).activeSource).toBeNull();
  });
});
