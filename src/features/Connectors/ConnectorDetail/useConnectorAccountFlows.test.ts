/**
 * @vitest-environment happy-dom
 */
import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ConnectorLinkSummary, ConnectorWithTools } from '@/store/tool/slices/connector/types';
import { ConnectorOAuthError } from '@/utils/connectorOAuth';

import { useConnectorAccountFlows } from './useConnectorAccountFlows';

const mocks = vi.hoisted(() => ({
  confirmModal: vi.fn(),
  openConnectorOAuthPopup: vi.fn(),
  openRenameModal: vi.fn(),
  refreshConnectorManagePolicy: vi.fn(),
  state: {
    connectConnectorAccount: vi.fn(),
    connectors: [] as Array<{ id: string; links?: Array<{ id: string; name: string }> }>,
    reauthorizeConnectorAccount: vi.fn(),
    removeConnectorAccount: vi.fn(),
    renameConnectorAccount: vi.fn(),
  },
  toast: { error: vi.fn(), info: vi.fn(), success: vi.fn(), warning: vi.fn() },
}));

// Keys come back with their interpolation values, so a test can tell which
// message (and which account) a toast or line names.
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) => {
      const values = Object.entries(options ?? {})
        .filter(([name]) => name !== 'ns')
        .map(([name, value]) => `${name}=${value}`)
        .join(',');
      return values ? `${key}(${values})` : key;
    },
  }),
}));

vi.mock('@lobehub/ui', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  confirmModal: mocks.confirmModal,
  toast: mocks.toast,
}));

vi.mock('@/components/RenameModal', () => ({ openRenameModal: mocks.openRenameModal }));

vi.mock('@/services/connectorManagePolicy', () => ({
  refreshConnectorManagePolicy: mocks.refreshConnectorManagePolicy,
}));

vi.mock('@/store/tool', () => {
  const useToolStore = (selector: (state: typeof mocks.state) => unknown) => selector(mocks.state);
  useToolStore.getState = () => mocks.state;
  return { useToolStore };
});

vi.mock('@/store/tool/slices/connector', async () => ({
  ...(await import('@/store/tool/slices/connector/types')),
  connectorSelectors: {
    connectorLinkNameById: (linkId: string) => (state: typeof mocks.state) =>
      state.connectors.flatMap((c) => c.links ?? []).find((link) => link.id === linkId)?.name,
  },
}));

vi.mock('@/utils/connectorOAuth', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  openConnectorOAuthPopup: mocks.openConnectorOAuthPopup,
}));

const makeLink = (id: string, name: string) =>
  ({
    authorizedByAvatar: null,
    authorizedByName: null,
    createdAt: '2026-11-01T00:00:00.000Z',
    id,
    name,
    profile: null,
    status: 'connected',
  }) as ConnectorLinkSummary;

const work = makeLink('lnk_work', 'work@acme.com');
const personal = makeLink('lnk_personal', 'Personal');

const setup = (links: ConnectorLinkSummary[]) => {
  const connector = { id: 'connector-1', links } as ConnectorWithTools;
  mocks.state.connectors = [{ id: connector.id, links }];
  return renderHook(() => useConnectorAccountFlows(connector));
};

describe('useConnectorAccountFlows', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.openConnectorOAuthPopup.mockReturnValue({ close: vi.fn() });
  });

  describe('connect', () => {
    it('opens the popup before awaiting and announces the new account', async () => {
      mocks.state.connectConnectorAccount.mockImplementation(async () => {
        // The action refetches the list before it resolves.
        mocks.state.connectors[0].links = [work, makeLink('lnk_new', 'Account 2')];
        return { linkId: 'lnk_new', outcome: 'created' };
      });
      const { result } = setup([work]);

      let running!: Promise<void>;
      act(() => {
        running = result.current.connect();
      });
      // Synchronously within the click, or the browser blocks the window.
      expect(mocks.openConnectorOAuthPopup).toHaveBeenCalledTimes(1);
      expect(result.current.busy).toEqual({ kind: 'connect' });
      await act(() => running);

      expect(mocks.state.connectConnectorAccount).toHaveBeenCalledWith('connector-1', {
        popup: expect.anything(),
      });
      expect(mocks.toast.success).toHaveBeenCalledWith(
        'connector.account.connected(name=Account 2)',
      );
      expect(result.current.busy).toBeUndefined();
    });

    it('says the account was already connected when nothing was added', async () => {
      mocks.state.connectConnectorAccount.mockResolvedValue({
        linkId: 'lnk_work',
        outcome: 'matchedExisting',
      });
      const { result } = setup([work]);

      await act(() => result.current.connect());

      expect(mocks.toast.info).toHaveBeenCalledWith({
        description: 'connector.account.alreadyConnectedDesc',
        title: 'connector.account.alreadyConnected(name=work@acme.com)',
      });
      expect(mocks.toast.success).not.toHaveBeenCalled();
    });

    it('still says so when the matched account cannot be named', async () => {
      mocks.state.connectConnectorAccount.mockResolvedValue({ outcome: 'matchedExisting' });
      const { result } = setup([work]);

      await act(() => result.current.connect());

      expect(mocks.toast.info).toHaveBeenCalledWith({
        description: 'connector.account.alreadyConnectedDesc',
        title: 'connector.account.alreadyConnectedUnnamed',
      });
    });

    it('stays quiet when the user closes the authorization window', async () => {
      mocks.state.connectConnectorAccount.mockRejectedValue(new ConnectorOAuthError('dismissed'));
      const { result } = setup([work]);

      await act(() => result.current.connect());

      expect(mocks.toast.error).not.toHaveBeenCalled();
      expect(result.current.failure).toBeUndefined();
    });

    it('keeps a retryable failure in place and frees the button', async () => {
      mocks.state.connectConnectorAccount.mockRejectedValue(new ConnectorOAuthError('timeout'));
      const { result } = setup([work]);

      await act(() => result.current.connect());

      const message = 'connector.account.connectFailed(reason=connector.account.error.timeout)';
      expect(mocks.toast.error).toHaveBeenCalledWith(message);
      expect(result.current.failure).toBe(message);
      expect(result.current.busy).toBeUndefined();
    });

    it('passes on the reason a server gives for refusing', async () => {
      const refusal = Object.assign(new Error('Dynamic client registration failed: 403'), {
        data: { code: 'BAD_REQUEST' },
      });
      mocks.state.connectConnectorAccount.mockRejectedValue(refusal);
      const { result } = setup([work]);

      await act(() => result.current.connect());

      expect(result.current.failure).toBe(
        'connector.account.connectFailed(reason=Dynamic client registration failed: 403)',
      );
    });

    it('reports a blocked window without starting the flow', async () => {
      mocks.openConnectorOAuthPopup.mockReturnValue(null);
      const { result } = setup([work]);

      await act(() => result.current.connect());

      expect(mocks.state.connectConnectorAccount).not.toHaveBeenCalled();
      expect(result.current.failure).toBe(
        'connector.account.connectFailed(reason=dev.oauthError.blocked)',
      );
    });

    it('refetches the manage policy instead of reporting a stale-permission rejection', async () => {
      mocks.state.connectConnectorAccount.mockRejectedValue({ data: { httpStatus: 403 } });
      const { result } = setup([work]);

      await act(() => result.current.connect());

      expect(mocks.refreshConnectorManagePolicy).toHaveBeenCalled();
      expect(mocks.toast.error).not.toHaveBeenCalled();
      expect(result.current.failure).toBeUndefined();
    });
  });

  describe('reauthorize', () => {
    it('re-authorizes the chosen account', async () => {
      mocks.state.reauthorizeConnectorAccount.mockResolvedValue({
        linkId: 'lnk_personal',
        outcome: 'reauthorized',
      });
      const { result } = setup([work, personal]);

      await act(() => result.current.reauthorize(personal));

      expect(mocks.openConnectorOAuthPopup).toHaveBeenCalledTimes(1);
      expect(mocks.state.reauthorizeConnectorAccount).toHaveBeenCalledWith(
        'connector-1',
        'lnk_personal',
        { popup: expect.anything() },
      );
      expect(mocks.toast.success).toHaveBeenCalledWith(
        'connector.account.reauthorized(name=Personal)',
      );
    });

    it('warns when the provider signed in as another connected account', async () => {
      mocks.state.reauthorizeConnectorAccount.mockResolvedValue({
        linkId: 'lnk_work',
        outcome: 'matchedExisting',
      });
      const { result } = setup([work, personal]);

      await act(() => result.current.reauthorize(personal));

      expect(mocks.toast.warning).toHaveBeenCalledWith({
        description:
          'connector.account.reauthorizeMismatchDesc(matched=work@acme.com,name=Personal)',
        title: 'connector.account.reauthorizeMismatch(name=Personal)',
      });
      expect(mocks.toast.success).not.toHaveBeenCalled();
    });
  });

  describe('rename', () => {
    const openRename = (link: ConnectorLinkSummary, links = [work, personal]) => {
      const { result } = setup(links);
      act(() => result.current.rename(link));
      return mocks.openRenameModal.mock.calls[0][0] as {
        defaultValue: string;
        description: string;
        maxLength: number;
        onSave: (name: string) => Promise<void>;
      };
    };

    it('explains what the name is for and saves it', async () => {
      const modal = openRename(work);

      expect(modal).toMatchObject({
        defaultValue: 'work@acme.com',
        description: 'connector.account.renameDesc',
        maxLength: 64,
      });

      await modal.onSave('Work');
      expect(mocks.state.renameConnectorAccount).toHaveBeenCalledWith(
        'connector-1',
        'lnk_work',
        'Work',
      );
    });

    it('keeps the dialog open and names the clash when another account has the name', async () => {
      mocks.state.renameConnectorAccount.mockRejectedValue({ data: { code: 'CONFLICT' } });
      const modal = openRename(work);

      // A rejected save is what keeps RenameModal open with the typed name.
      await expect(modal.onSave('Personal')).rejects.toBeTruthy();
      expect(mocks.toast.error).toHaveBeenCalledWith(
        'connector.account.renameConflict(name=Personal)',
      );
    });
  });

  describe('remove', () => {
    it('warns that the tools stop working when removing the last account', () => {
      const { result } = setup([work]);

      act(() => result.current.remove(work));

      expect(mocks.confirmModal).toHaveBeenCalledWith(
        expect.objectContaining({
          cancelText: 'cancel',
          content: 'connector.account.removeLastConfirmContent',
          okButtonProps: { danger: true },
          okText: 'connector.account.removeConfirmOk',
          title: 'connector.account.removeConfirmTitle(name=work@acme.com)',
        }),
      );
    });

    it('describes only this account when others stay connected, then removes it', async () => {
      const { result } = setup([work, personal]);

      act(() => result.current.remove(personal));
      const config = mocks.confirmModal.mock.calls[0][0];
      expect(config).toMatchObject({
        content: 'connector.account.removeConfirmContent',
        title: 'connector.account.removeConfirmTitle(name=Personal)',
      });

      await act(() => config.onOk());
      expect(mocks.state.removeConnectorAccount).toHaveBeenCalledWith(
        'connector-1',
        'lnk_personal',
      );
    });

    it('says the account is still connected when removing fails', async () => {
      mocks.state.removeConnectorAccount.mockRejectedValue(new Error('boom'));
      const { result } = setup([work, personal]);

      act(() => result.current.remove(work));
      await act(() => mocks.confirmModal.mock.calls[0][0].onOk());

      expect(result.current.failure).toBe(
        'connector.account.removeFailed(name=work@acme.com,reason=connector.account.error.retry)',
      );
    });
  });
});
