import { describe, expect, it } from 'vitest';

import { getFlowNodeCount, getFlowRoundViews, resolveAcceptanceTab } from './flowNavigation';

describe('acceptance flow navigation', () => {
  it('falls back to the original checklist when all nodes disappear', () => {
    expect(resolveAcceptanceTab('flow', 0)).toBe('checks');
  });
  it('keeps the requested surface when it is available', () => {
    expect(resolveAcceptanceTab('flow', 2)).toBe('flow');
    expect(resolveAcceptanceTab('resources', 0)).toBe('resources');
  });
  it('opens the discussion only when asked, never as the landing tab', () => {
    expect(resolveAcceptanceTab('discussion', 0)).toBe('discussion');
    expect(resolveAcceptanceTab('discussion', 3, true, false)).toBe('discussion');
    expect(resolveAcceptanceTab(undefined, 0)).toBe('checks');
  });
});

const makeFlows = () =>
  [
    {
      versions: [
        { id: 'v2', nodes: [{ id: 'new-node' }], runs: [] },
        {
          id: 'v1',
          nodes: [{ id: 'old-node' }],
          runs: [
            { id: 'visit-b', verifyRunId: 'round-b' },
            { id: 'visit-a', verifyRunId: 'round-a' },
          ],
        },
      ],
    },
  ] as NonNullable<Parameters<typeof getFlowRoundViews>[0]>;

it('uses acceptance round numbers across versions, not version-local run positions', () => {
  const rounds = [
    { run: { id: 'round-a', roundIndex: 4 } },
    { run: { id: 'round-b', roundIndex: 9 } },
  ] as Parameters<typeof getFlowRoundViews>[1];
  const views = getFlowRoundViews(makeFlows(), rounds);
  expect(views.map(({ id, roundIndex, version }) => [id, roundIndex, version.id])).toEqual([
    ['v2', undefined, 'v2'],
    ['v1:visit-b', 9, 'v1'],
    ['v1:visit-a', 4, 'v1'],
  ]);
});

it('does not offer a flow when definitions have no nodes', () => {
  const flows = makeFlows();
  for (const version of flows[0].versions) version.nodes = [];
  expect(getFlowNodeCount(flows)).toBe(0);
  expect(getFlowRoundViews(flows)).toEqual([]);
  expect(getFlowNodeCount()).toBe(0);
});

it('keeps an older populated definition available when the newest has no nodes', () => {
  const flows = makeFlows();
  flows[0].versions[0].nodes = [];
  expect(getFlowNodeCount(flows)).toBe(1);
});

it('keeps each business flow selectable when they share a verification round', () => {
  const flows = makeFlows();
  const first = flows[0].versions[1];
  first.runs = [{ ...first.runs[0], id: 'round-b' }];
  flows.push({ ...flows[0], versions: [{ ...first, id: 'other-flow-version' }] });
  const rounds = [{ run: { id: 'round-b', roundIndex: 9 } }] as Parameters<
    typeof getFlowRoundViews
  >[1];
  const views = getFlowRoundViews(flows, rounds).filter((view) => view.roundIndex === 9);
  expect(views).toHaveLength(2);
  expect(new Set(views.map((view) => view.id)).size).toBe(2);
  for (const view of views)
    expect(views.find((candidate) => candidate.id === view.id)?.version).toBe(view.version);
});

it('opens a proposed flow first while preserving an explicit user tab choice', () => {
  expect(resolveAcceptanceTab(undefined, 3, true)).toBe('flow');
  expect(resolveAcceptanceTab('checks', 3, true)).toBe('checks');
  expect(resolveAcceptanceTab(undefined, 3, false)).toBe('checks');
  expect(resolveAcceptanceTab(undefined, 0, true)).toBe('checks');
});

it('falls back from draft and selected flows when the surface does not offer flows', () => {
  expect(resolveAcceptanceTab(undefined, 3, true, false)).toBe('checks');
  expect(resolveAcceptanceTab('flow', 3, false, false)).toBe('checks');
  expect(resolveAcceptanceTab('resources', 3, true, false)).toBe('resources');
  expect(resolveAcceptanceTab('flow', 3, false, true)).toBe('flow');
});

it('shows a draft round as the pending plan and hides the unsynced live copy', () => {
  const flows = makeFlows();
  const rounds = [
    { run: { id: 'round-a', roundIndex: 4 } },
    {
      run: {
        id: 'round-b',
        planConfirmedAt: null,
        roundIndex: 9,
        status: 'planned',
        userDecision: null,
      },
    },
  ] as Parameters<typeof getFlowRoundViews>[1];
  const views = getFlowRoundViews(flows, rounds);
  expect(views.map(({ id, roundIndex }) => [id, roundIndex])).toEqual([
    ['v1:visit-b', undefined],
    ['v1:visit-a', 4],
  ]);
});
