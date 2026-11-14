/**
 * @vitest-environment happy-dom
 */
import { render, screen, waitFor } from '@testing-library/react';
import { TRPCClientError } from '@trpc/client';
import { SWRConfig } from 'swr';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { SharedGoalData } from './sharedGoalTypes';
import SharedGoalView from './SharedGoalView';

const query = vi.hoisted(() => vi.fn());

vi.mock('@/libs/trpc/client', () => ({
  lambdaClient: { goalShare: { getSharedGoal: { query } } },
}));

vi.mock('react-router', () => ({ useParams: () => ({ id: 'share_1' }) }));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

// The chrome around the page is the shell's job; its error slot is the real one.
vi.mock('@/business/client/features/ShareChrome', () => ({
  // Optional extension slot the layout reads by name; this page has none.
  ShareHeaderActions: undefined,
  ShareHeaderMenu: () => null,
  ShareLogoLink: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock('@/components/Branding', () => ({ ProductLogo: () => null }));
vi.mock('@/components/Loading/BrandTextLoading', () => ({
  default: () => <div data-testid={'loading'} />,
}));
vi.mock('@/features/User/UserLoginOrSignup/trackLoginOrSignupClicked', () => ({
  trackLoginOrSignupClicked: vi.fn(),
}));
vi.mock('@/components/404', () => ({
  default: ({ title }: { title: string }) => <div data-testid={'not-found'}>{title}</div>,
}));

vi.mock('@lobehub/ui', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    Markdown: ({ children }: { children: string }) => <div>{children}</div>,
  };
});

// The map is client-only and canvas-based; the view's job is to mount it.
vi.mock('./SharedGoalGraph.client', () => ({
  default: () => <div data-testid={'graph'} />,
}));

const goal = (extra: Partial<SharedGoalData> = {}): SharedGoalData => ({
  acceptance: {
    checks: [
      { passed: true, state: 'passed', summary: 'Looks right.', title: 'Page renders' },
      { passed: false, state: 'failed', summary: null, title: 'Chart shows data' },
    ],
    status: 'passed',
  },
  edges: [],
  goal: { requirement: null, status: 'achieved', title: 'Ship the share page' },
  isOwner: false,
  nodes: [
    { dependsOn: [], id: 'n1', kind: 'problem', status: 'resolved', title: 'How to ship?' },
    {
      acceptance: {
        checks: [{ passed: true, state: 'passed', summary: null, title: 'Builds' }],
        status: 'passed',
      },
      dependsOn: [],
      id: 'n2',
      kind: 'task',
      status: 'resolved',
      title: 'Build the page',
    },
  ],
  report: {
    chapters: [
      { detours: [], findingIds: [], narrative: 'We built it.', nodeIds: [], title: 'Building' },
    ],
    headline: 'The page shipped',
    nextSteps: [],
  },
  visibility: 'link',
  ...extra,
});

const renderView = () =>
  render(
    <SWRConfig value={{ dedupingInterval: 0, provider: () => new Map() }}>
      <SharedGoalView />
    </SWRConfig>,
  );

const trpcError = (code: string) =>
  Object.assign(Object.create(TRPCClientError.prototype), {
    data: { code },
    message: code,
    name: 'TRPCClientError',
  });

describe('SharedGoalView', () => {
  beforeEach(() => {
    query.mockReset();
  });

  it('reads the share by its id, not by a goal id', async () => {
    query.mockResolvedValue({ data: goal(), success: true });
    renderView();

    await screen.findByText('The page shipped');
    expect(query).toHaveBeenCalledWith({ shareId: 'share_1' });
  });

  it('shows headline and status, then the report, the map and the acceptance — in that order', async () => {
    query.mockResolvedValue({ data: goal(), success: true });
    const { container } = renderView();

    await screen.findByText('The page shipped');
    const text = container.textContent ?? '';
    const order = [
      'goalList.status.achieved',
      'The page shipped',
      'goalShare.report.title',
      'We built it.',
      'goalShare.acceptance.title',
    ].map((needle) => text.indexOf(needle));

    expect(order.every((index) => index >= 0)).toBe(true);
    expect(order).toEqual([...order].sort((a, b) => a - b));
    expect(screen.getByTestId('graph')).toBeTruthy();
    // Map sits between the report and the acceptance.
    const graphAt = container.innerHTML.indexOf('data-testid="graph"');
    expect(graphAt).toBeGreaterThan(container.innerHTML.indexOf('We built it.'));
    expect(graphAt).toBeLessThan(container.innerHTML.indexOf('goalShare.acceptance.title'));
  });

  it('lists the Goal-level acceptance and each task’s own, with criteria and verdicts', async () => {
    query.mockResolvedValue({ data: goal(), success: true });
    renderView();

    await screen.findByText('goalShare.acceptance.goalLevel');
    expect(screen.getByText('Page renders')).toBeTruthy();
    expect(screen.getByText('Chart shows data')).toBeTruthy();
    expect(screen.getByText('goalShare.acceptance.taskLevel')).toBeTruthy();
    expect(screen.getByText('Build the page')).toBeTruthy();
    expect(screen.getByText('Builds')).toBeTruthy();
  });

  it('is read-only: it links nowhere into the product', async () => {
    query.mockResolvedValue({ data: goal(), success: true });
    const { container } = renderView();

    await screen.findByText('The page shipped');
    expect(container.querySelector('a[href]')).toBeNull();
  });

  it('says so when the goal has nothing to show yet', async () => {
    query.mockResolvedValue({
      data: goal({ acceptance: null, nodes: [], report: null }),
      success: true,
    });
    renderView();

    expect(await screen.findByText('goalShare.empty')).toBeTruthy();
    expect(screen.queryByTestId('graph')).toBeNull();
  });

  it('keeps the page up when only the report is missing', async () => {
    query.mockResolvedValue({ data: goal({ report: null }), success: true });
    renderView();

    await screen.findByText('goalShare.acceptance.title');
    expect(screen.queryByText('goalShare.report.title')).toBeNull();
    expect(screen.getByTestId('graph')).toBeTruthy();
    expect(screen.getByText('goalShare.acceptance.title')).toBeTruthy();
  });

  it('tells the owner their private share is private', async () => {
    query.mockResolvedValue({
      data: goal({ isOwner: true, visibility: 'private' }),
      success: true,
    });
    renderView();

    expect(await screen.findByText('goalShare.private.ownerOnly')).toBeTruthy();
  });

  it('shows the forbidden state, and no content, to a visitor of a private share', async () => {
    query.mockRejectedValue(trpcError('FORBIDDEN'));
    renderView();

    expect(await screen.findByTestId('not-found')).toBeTruthy();
    expect(screen.getByText('sharePage.error.forbidden.title')).toBeTruthy();
    expect(screen.queryByTestId('graph')).toBeNull();
  });

  it('shows the not-found state for a share that does not exist', async () => {
    query.mockRejectedValue(trpcError('NOT_FOUND'));
    renderView();

    expect(await screen.findByText('sharePage.error.notFound.title')).toBeTruthy();
  });

  it('shows the loading state until the share arrives', async () => {
    let resolve: (value: unknown) => void = () => {};
    query.mockReturnValue(new Promise((r) => (resolve = r)));
    renderView();

    expect(screen.getByTestId('loading')).toBeTruthy();
    resolve({ data: goal(), success: true });
    await waitFor(() => expect(screen.queryByTestId('loading')).toBeNull());
  });
});
