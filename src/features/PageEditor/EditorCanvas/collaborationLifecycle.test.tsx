/**
 * @vitest-environment happy-dom
 */
import { render, screen, waitFor } from '@testing-library/react';
import { type ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

import {
  PAGE_COLLABORATION_SHOULD_BOOTSTRAP,
  type PageCollaborationEditorLifecycleOptions,
  subscribePageCollaborationProvider,
  usePageCollaborationEditorLifecycle,
} from './collaborationLifecycle';

const CollaborationLifecycleProbe = (props: PageCollaborationEditorLifecycleOptions): ReactNode => {
  const lifecycle = usePageCollaborationEditorLifecycle(props);
  const plugins = lifecycle.collaborationEnabled ? ['ReactYjsPlugin'] : [];

  return (
    <div
      data-collaboration-enabled={String(lifecycle.collaborationEnabled)}
      data-editable={String(lifecycle.editable)}
      data-plugins={plugins.join(',')}
      data-testid="lifecycle"
      data-waiting={String(lifecycle.isWaitingForCollaboration)}
    />
  );
};

const roomProps = (
  overrides: Partial<PageCollaborationEditorLifecycleOptions> = {},
): PageCollaborationEditorLifecycleOptions => ({
  collaborationUrl: 'ws://localhost:28168/yjs',
  documentId: 'page-1',
  editable: true,
  hasProviderFactory: false,
  hasValidBrowserTicket: false,
  providerHasSynced: true,
  providerHasSyncedOnce: true,
  ...overrides,
});

describe('Page collaboration editor lifecycle', () => {
  it('never bootstraps host JSON into the authoritative Page room', () => {
    expect(PAGE_COLLABORATION_SHOULD_BOOTSTRAP).toBe(false);
  });

  it('defers editable mounting while the browser ticket/provider is unresolved', () => {
    const resetEditor = vi.fn();

    render(<CollaborationLifecycleProbe {...roomProps({ resetEditor })} />);

    expect(screen.getByTestId('lifecycle')).toBeInTheDocument();
    expect(screen.getByTestId('lifecycle')).toHaveAttribute('data-editable', 'false');
    expect(screen.getByTestId('lifecycle')).toHaveAttribute('data-plugins', '');
    expect(screen.getByTestId('lifecycle')).toHaveAttribute('data-waiting', 'true');
    expect(resetEditor).not.toHaveBeenCalled();
  });

  it('resets the editor before exposing the first editable collaborative lifecycle', async () => {
    const resetEditor = vi.fn();
    const { rerender } = render(<CollaborationLifecycleProbe {...roomProps({ resetEditor })} />);

    rerender(
      <CollaborationLifecycleProbe
        {...roomProps({
          hasProviderFactory: true,
          hasValidBrowserTicket: true,
          resetEditor,
        })}
      />,
    );

    await waitFor(() => expect(resetEditor).toHaveBeenCalledTimes(1));
    expect(screen.getByTestId('lifecycle')).toHaveAttribute('data-editable', 'true');
    expect(screen.getByTestId('lifecycle')).toHaveAttribute('data-collaboration-enabled', 'true');
    expect(screen.getByTestId('lifecycle')).toHaveAttribute('data-plugins', 'ReactYjsPlugin');
  });

  it('keeps the initial editor read-only until the provider sync barrier completes', async () => {
    const resetEditor = vi.fn();

    render(
      <CollaborationLifecycleProbe
        {...roomProps({
          hasProviderFactory: true,
          hasValidBrowserTicket: true,
          providerHasSynced: false,
          providerHasSyncedOnce: false,
          resetEditor,
        })}
      />,
    );

    await waitFor(() => expect(resetEditor).toHaveBeenCalledTimes(1));
    expect(screen.getByTestId('lifecycle')).toHaveAttribute('data-editable', 'false');
    expect(screen.getByTestId('lifecycle')).toHaveAttribute('data-waiting', 'true');
  });

  it('keeps transient reconnects editable after one completed sync', async () => {
    const resetEditor = vi.fn();
    const { rerender } = render(
      <CollaborationLifecycleProbe
        {...roomProps({
          hasProviderFactory: true,
          hasValidBrowserTicket: true,
          resetEditor,
        })}
      />,
    );

    await waitFor(() => expect(resetEditor).toHaveBeenCalledTimes(1));

    rerender(
      <CollaborationLifecycleProbe
        {...roomProps({
          hasProviderFactory: true,
          hasValidBrowserTicket: true,
          providerHasSynced: false,
          providerHasSyncedOnce: true,
          resetEditor,
        })}
      />,
    );

    expect(screen.getByTestId('lifecycle')).toHaveAttribute('data-editable', 'true');
    expect(screen.getByTestId('lifecycle')).toHaveAttribute('data-collaboration-enabled', 'true');
    expect(screen.getByTestId('lifecycle')).toHaveAttribute('data-waiting', 'false');
  });

  it('fails closed on a terminal provider error after a sync', async () => {
    const resetEditor = vi.fn();
    const { rerender } = render(
      <CollaborationLifecycleProbe
        {...roomProps({
          hasProviderFactory: true,
          hasValidBrowserTicket: true,
          resetEditor,
        })}
      />,
    );

    await waitFor(() => expect(resetEditor).toHaveBeenCalledTimes(1));
    rerender(
      <CollaborationLifecycleProbe
        {...roomProps({
          hasProviderFactory: true,
          hasValidBrowserTicket: true,
          providerError: { code: 'provider_terminated', message: 'socket ended' },
          providerHasSynced: false,
          providerHasSyncedOnce: true,
          resetEditor,
        })}
      />,
    );

    expect(screen.getByTestId('lifecycle')).toHaveAttribute('data-editable', 'false');
    expect(screen.getByTestId('lifecycle')).toHaveAttribute('data-waiting', 'false');
  });

  it('bridges provider waitForSync rejection into a terminal error', async () => {
    let syncListener: ((synced: boolean) => void) | undefined;
    let statusListener: ((event: { status: string }) => void) | undefined;
    const provider = {
      off: vi.fn((type: string, listener: unknown) => {
        if (type === 'sync' && syncListener === listener) syncListener = undefined;
        if (type === 'status' && statusListener === listener) statusListener = undefined;
      }),
      on: vi.fn((type: string, listener: unknown) => {
        if (type === 'sync') syncListener = listener as (synced: boolean) => void;
        if (type === 'status') statusListener = listener as (event: { status: string }) => void;
      }),
      waitForSync: vi.fn().mockRejectedValue(
        Object.assign(new Error('relay unavailable'), {
          code: 'backend_unavailable',
          fatal: true,
        }),
      ),
    };
    const service = {
      subscribe: (listener: (state: { provider: typeof provider }) => void) => {
        listener({ provider });
        return () => undefined;
      },
    };
    const states: unknown[] = [];
    subscribePageCollaborationProvider(service, (state) => states.push(state));

    statusListener?.({ status: 'disconnected' });
    await waitFor(() =>
      expect(states.at(-1)).toMatchObject({
        error: { code: 'backend_unavailable', fatal: true },
      }),
    );
    expect(syncListener).toBeDefined();
    expect(provider.waitForSync).toHaveBeenCalled();

    // A late sync=false/status=disconnected pair must not clear the terminal
    // error and re-enable the editor on the same provider generation.
    syncListener?.(false);
    statusListener?.({ status: 'disconnected' });
    await waitFor(() => expect(provider.waitForSync).toHaveBeenCalledTimes(2));
    await waitFor(() =>
      expect(states.at(-1)).toMatchObject({
        error: { code: 'backend_unavailable', fatal: true },
      }),
    );
  });

  it('keeps the initial barrier and transient reconnect state distinct', async () => {
    let resolveInitial!: () => void;
    let resolveReconnect!: () => void;
    let syncListener: ((synced: boolean) => void) | undefined;
    let statusListener: ((event: { status: string }) => void) | undefined;
    const provider = {
      off: vi.fn(),
      on: vi.fn((type: string, listener: unknown) => {
        if (type === 'sync') syncListener = listener as (synced: boolean) => void;
        if (type === 'status') statusListener = listener as (event: { status: string }) => void;
      }),
      waitForSync: vi
        .fn()
        .mockImplementationOnce(() => new Promise<void>((resolve) => (resolveInitial = resolve)))
        .mockImplementationOnce(() => new Promise<void>((resolve) => (resolveReconnect = resolve))),
    };
    const service = {
      subscribe: (listener: (state: { provider: typeof provider }) => void) => {
        listener({ provider });
        return () => undefined;
      },
    };
    const states: Array<{ hasSynced: boolean; hasSyncedOnce: boolean }> = [];
    subscribePageCollaborationProvider(service, ({ hasSynced, hasSyncedOnce }) =>
      states.push({ hasSynced, hasSyncedOnce }),
    );

    expect(states.at(-1)).toEqual({ hasSynced: false, hasSyncedOnce: false });
    await waitFor(() => expect(provider.waitForSync).toHaveBeenCalledTimes(1));
    resolveInitial();
    await waitFor(() => expect(states.at(-1)).toEqual({ hasSynced: true, hasSyncedOnce: true }));

    syncListener?.(false);
    expect(states.at(-1)).toEqual({ hasSynced: false, hasSyncedOnce: true });
    statusListener?.({ status: 'disconnected' });
    await waitFor(() => expect(provider.waitForSync).toHaveBeenCalledTimes(2));
    resolveReconnect();
    await waitFor(() => expect(states.at(-1)).toEqual({ hasSynced: true, hasSyncedOnce: true }));
  });

  it('remains read-only after an initial ticket/provider failure', () => {
    const resetEditor = vi.fn();

    render(
      <CollaborationLifecycleProbe
        {...roomProps({
          hasProviderFactory: false,
          hasValidBrowserTicket: false,
          resetEditor,
        })}
      />,
    );

    expect(screen.getByTestId('lifecycle')).toHaveAttribute('data-editable', 'false');
    expect(screen.getByTestId('lifecycle')).toHaveAttribute('data-waiting', 'true');
    expect(resetEditor).not.toHaveBeenCalled();
  });

  it('preserves a read-only display without requiring a collaboration ticket', () => {
    const resetEditor = vi.fn();

    render(
      <CollaborationLifecycleProbe
        {...roomProps({
          editable: false,
          resetEditor,
        })}
      />,
    );

    const output = screen.getByTestId('lifecycle');
    expect(output).toHaveAttribute('data-editable', 'false');
    expect(output).toHaveAttribute('data-waiting', 'false');
    expect(resetEditor).not.toHaveBeenCalled();
  });

  it('fails closed when a ready room has no editor reset capability', () => {
    render(
      <CollaborationLifecycleProbe
        {...roomProps({
          hasProviderFactory: true,
          hasValidBrowserTicket: true,
        })}
      />,
    );

    expect(screen.getByTestId('lifecycle')).toHaveAttribute('data-editable', 'false');
  });
});
