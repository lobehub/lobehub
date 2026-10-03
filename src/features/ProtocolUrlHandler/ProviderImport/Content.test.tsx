/**
 * @vitest-environment happy-dom
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { PropsWithChildren, ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import ProviderImportContent from './Content';

const mocks = vi.hoisted(() => {
  const permission = { allowed: false, reason: 'requires owner' };

  return {
    applyProviderImport: vi.fn(),
    cancel: vi.fn(),
    close: vi.fn(),
    consume: vi.fn(),
    permission,
    usePermission: vi.fn(() => permission),
  };
});

vi.mock('@lobehub/ui', () => ({
  Flexbox: ({ children }: PropsWithChildren) => <div>{children}</div>,
  Tooltip: ({ children, title }: PropsWithChildren<{ title?: ReactNode }>) => (
    <div>
      {title}
      {children}
    </div>
  ),
}));

vi.mock('@lobehub/ui/base-ui', () => ({
  Alert: ({ description, title }: { description?: ReactNode; title?: ReactNode }) => (
    <div>
      {title}
      {description}
    </div>
  ),
  Button: ({
    children,
    disabled,
    onClick,
  }: PropsWithChildren<{ disabled?: boolean; onClick?: () => void }>) => (
    <button disabled={disabled} type={'button'} onClick={onClick}>
      {children}
    </button>
  ),
  ModalFooter: ({ children }: PropsWithChildren) => <div>{children}</div>,
  Text: ({ children }: PropsWithChildren) => <span>{children}</span>,
  toast: { error: vi.fn(), success: vi.fn() },
  useModalContext: () => ({ close: mocks.close }),
}));

vi.mock('@/hooks/usePermission', () => ({
  usePermission: mocks.usePermission,
}));

vi.mock('@/utils/electron/ipc', () => ({
  ensureElectronIpc: () => ({
    providerImport: { cancel: mocks.cancel, consume: mocks.consume },
  }),
}));

vi.mock('./applyProviderImport', () => ({
  applyProviderImport: mocks.applyProviderImport,
  BuiltinProviderImportError: class extends Error {},
  PartialProviderImportError: class extends Error {},
  ProviderOverwriteNotConfirmedError: class extends Error {},
}));

const preview = {
  modelCount: 1,
  provider: {
    baseURL: 'https://api.example.com/v1',
    id: 'example-provider',
    name: 'Example Provider',
  },
  requestId: 'request-1',
};

describe('ProviderImportContent', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.permission.allowed = false;
  });

  it('disables provider import when provider management is denied', () => {
    render(<ProviderImportContent preview={preview} />);

    const importButton = screen.getByRole('button', { name: 'providerImport.confirm' });
    expect(importButton).toBeDisabled();
    expect(screen.getByText('requires owner')).toBeInTheDocument();
    expect(mocks.usePermission).toHaveBeenCalledWith('manage_provider_key');

    fireEvent.click(importButton);

    expect(mocks.consume).not.toHaveBeenCalled();
    expect(mocks.applyProviderImport).not.toHaveBeenCalled();
  });

  it('binds overwrite confirmation to the reviewed provider identity', async () => {
    mocks.permission.allowed = true;
    mocks.consume.mockResolvedValue({
      models: [],
      provider: { apiKey: 'secret', ...preview.provider },
      version: 1,
    });
    mocks.applyProviderImport.mockResolvedValue(undefined);

    render(
      <ProviderImportContent
        preview={preview}
        existingProvider={{
          id: 'example-provider',
          identity: 'reviewed-provider-row',
          name: 'Existing Provider',
          source: 'custom',
        }}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'providerImport.confirmOverwrite' }));

    await waitFor(() => {
      expect(mocks.applyProviderImport).toHaveBeenCalledWith(expect.any(Object), {
        expectedProviderIdentity: 'reviewed-provider-row',
      });
    });
  });
});
