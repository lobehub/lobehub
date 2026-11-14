/**
 * @vitest-environment happy-dom
 *
 * A pasted entity URL is titled from the entity preview replica, so a reload
 * paints the remembered title instead of flashing the raw URL first. Each
 * "reload" re-imports the module graph (fresh stores, fresh SWR cache) over the
 * same localStorage.
 */
import { randomUUID } from 'node:crypto';

import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { createElement, type PropsWithChildren } from 'react';
import { SWRConfig } from 'swr';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const scope = vi.hoisted(() => ({ current: '' }));

vi.mock('@/libs/swr/useCacheScope', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getCacheScope: () => scope.current,
  isScopeTrusted: () => true,
  useCacheScope: () => scope.current,
}));
vi.mock('@/libs/swr', async (importOriginal) => {
  const swr = await import('swr');
  return {
    ...(await importOriginal<Record<string, unknown>>()),
    mutate: swr.mutate,
    useClientDataSWR: swr.default,
  };
});
vi.mock('@lobehub/ui', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  // Render the card inline, opened on hover, so its content can be asserted.
  Popover: ({ children, content, onOpenChange }: any) =>
    createElement(
      'div',
      { 'data-testid': 'trigger', 'onMouseEnter': () => onOpenChange?.(true) },
      children,
      content,
    ),
}));
vi.mock('@/business/client/hooks/useWorkspaces', () => ({ useWorkspaces: () => [] }));
vi.mock('@/features/Workspace/useWorkspaceAwareNavigate', () => ({
  useWorkspaceAwareNavigate: () => vi.fn(),
}));
vi.mock('@/store/chat', () => ({
  useChatStore: (selector: (state: unknown) => unknown) => selector({}),
}));
vi.mock('@/store/agentDocument', () => ({
  agentDocumentActions: { fetchDocumentList: vi.fn(), useFetchDocumentList: vi.fn() },
  agentDocumentSelectors: { getDocumentList: () => () => undefined },
  useAgentDocumentStore: (selector: (state: unknown) => unknown) => selector({}),
}));

const wrapper = ({ children }: PropsWithChildren) =>
  createElement(SWRConfig, { value: { dedupingInterval: 0, provider: () => new Map() } }, children);

const PATH = '/task/T-198';
const task = (name: string) => ({
  data: { description: 'Rebuild the gateway queue', id: 'task_1', identifier: 'T-198', name },
});

const pending = () => new Promise<never>(() => {});

/** A fresh module graph: what a page reload starts from (localStorage survives). */
const reload = async () => {
  cleanup();
  vi.resetModules();
  const [{ InternalEntityLink }, { taskService }] = await Promise.all([
    import('./InternalEntityLink'),
    import('@/services/task'),
  ]);
  const getDetail = vi.spyOn(taskService, 'getDetail');
  const renderLink = () =>
    render(
      createElement(InternalEntityLink, {
        href: PATH,
        label: PATH,
        reference: { pathname: PATH, taskId: 'T-198', type: 'task' },
      }),
      { wrapper },
    );
  return { getDetail, renderLink };
};

/** Let the server answer reach the persisted copy before the next reload. */
const settle = () =>
  act(async () => {
    for (let i = 0; i < 20; i++) await new Promise((resolve) => setTimeout(resolve, 0));
  });

describe('InternalEntityLink across a reload', { timeout: 60_000 }, () => {
  beforeEach(() => {
    scope.current = `entity-link-user-${randomUUID()}:personal`;
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('paints the remembered title, not the URL, before the network answers', async () => {
    const first = await reload();
    first.getDetail.mockResolvedValue(task('Gateway queue rebuild') as never);
    const firstView = first.renderLink();
    await waitFor(() =>
      expect(firstView.container.querySelector('a')!.textContent).toBe('Gateway queue rebuild'),
    );
    await settle();

    const second = await reload();
    second.getDetail.mockImplementation(pending);
    const { container } = second.renderLink();
    await settle();

    expect(container.querySelector('a')!.textContent).toBe('Gateway queue rebuild');
  });

  it('replaces the remembered title once the server answers', async () => {
    const first = await reload();
    first.getDetail.mockResolvedValue(task('Old title') as never);
    first.renderLink();
    await settle();

    const second = await reload();
    let answer!: (value: unknown) => void;
    second.getDetail.mockImplementation(
      () =>
        new Promise((resolve) => {
          answer = resolve;
        }) as never,
    );
    const { container } = second.renderLink();
    await settle();
    expect(container.querySelector('a')!.textContent).toBe('Old title');

    await act(async () => {
      answer(task('Renamed title'));
    });
    await waitFor(() => expect(container.querySelector('a')!.textContent).toBe('Renamed title'));
  });

  it('opens the hover card on the remembered preview, without a skeleton', async () => {
    const first = await reload();
    first.getDetail.mockResolvedValue(task('Gateway queue rebuild') as never);
    first.renderLink();
    await settle();

    const second = await reload();
    second.getDetail.mockImplementation(pending);
    const { getByTestId, getByText } = second.renderLink();
    await settle();
    fireEvent.mouseEnter(getByTestId('trigger'));
    await settle();

    expect(getByText('Rebuild the gateway queue')).toBeInTheDocument();
  });
});
