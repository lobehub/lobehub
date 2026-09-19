/**
 * @vitest-environment happy-dom
 */
import { render, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import ProtocolUrlHandler from './index';

const mocks = vi.hoisted(() => ({
  cancel: vi.fn(),
  createProviderImportModal: vi.fn(),
  listPending: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock('@lobechat/electron-client-ipc', () => ({
  useWatchBroadcast: vi.fn(),
}));

vi.mock('@lobehub/ui/base-ui', () => ({
  toast: { error: mocks.toastError },
}));

vi.mock('@/utils/electron/ipc', () => ({
  ensureElectronIpc: () => ({
    providerImport: { cancel: mocks.cancel, listPending: mocks.listPending },
  }),
}));

vi.mock('./InstallPlugin', () => ({ default: () => null }));
vi.mock('./ProviderImport', () => ({
  createProviderImportModal: mocks.createProviderImportModal,
}));

describe('ProtocolUrlHandler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('recovers and acknowledges a provider import error queued before subscription', async () => {
    mocks.listPending.mockResolvedValue([
      { errorCode: 'callback_failed', requestId: 'failed-request', status: 'error' },
    ]);

    render(<ProtocolUrlHandler />);

    await waitFor(() => {
      expect(mocks.toastError).toHaveBeenCalledOnce();
    });
    expect(mocks.cancel).toHaveBeenCalledWith('failed-request');
    expect(mocks.createProviderImportModal).not.toHaveBeenCalled();
  });
});
