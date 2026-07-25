import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { SWRConfig } from 'swr';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { type ApiKeyItem, type CreateApiKeyParams } from '@/types/apiKey';

import ApiKey from './ApiKey';

const hoisted = vi.hoisted(() => ({
  createApiKeyModal: vi.fn(),
  message: { error: vi.fn(), success: vi.fn(), warning: vi.fn() },
  state: {
    activeWorkspaceId: null as string | null,
    allowed: true,
    manageSettingsAllowed: true,
    reason: '',
  },
  trpc: {
    createApiKey: vi.fn(),
    deleteApiKey: vi.fn(),
    getApiKeys: vi.fn(),
    updateApiKey: vi.fn(),
  },
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('antd', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    App: { useApp: () => ({ message: hoisted.message }) },
  };
});

vi.mock('@/business/client/hooks/useActiveWorkspaceId', () => ({
  getActiveWorkspaceId: () => hoisted.state.activeWorkspaceId,
  useActiveWorkspaceId: () => hoisted.state.activeWorkspaceId,
}));

vi.mock('@/hooks/usePermission', () => ({
  usePermission: (permission: string) => ({
    allowed:
      permission === 'manage_settings'
        ? hoisted.state.manageSettingsAllowed
        : hoisted.state.allowed,
    reason: hoisted.state.reason,
  }),
}));

vi.mock('@/libs/trpc/client', () => ({
  lambdaClient: {
    apiKey: {
      createApiKey: { mutate: hoisted.trpc.createApiKey },
      deleteApiKey: { mutate: hoisted.trpc.deleteApiKey },
      getApiKeys: { query: hoisted.trpc.getApiKeys },
      updateApiKey: { mutate: hoisted.trpc.updateApiKey },
    },
  },
}));

vi.mock('./index', () => ({
  ApiKeyDisplay: ({ apiKey }: { apiKey?: string }) => <span>{apiKey}</span>,
  createApiKeyModal: hoisted.createApiKeyModal,
  EditableCell: ({
    disabled,
    onSubmit,
    type,
    value,
  }: {
    disabled?: boolean;
    onSubmit: (value: string) => void;
    type: string;
    value: string | null;
  }) => (
    <span>
      <span>{value}</span>
      <button disabled={disabled} type="button" onClick={() => onSubmit('renamed')}>
        {`edit-${type}`}
      </button>
    </span>
  ),
}));

const makeItem = (over: Partial<ApiKeyItem> = {}): ApiKeyItem => ({
  accessedAt: new Date('2026-01-01'),
  createdAt: new Date('2026-01-01'),
  enabled: true,
  id: 'key-1',
  isMine: true,
  key: 'lb-plain-secret',
  lastUsedAt: null,
  name: 'My Key',
  updatedAt: new Date('2026-01-01'),
  userId: 'me',
  ...over,
});

const renderPage = () => {
  const queryClient = new QueryClient({
    defaultOptions: { mutations: { retry: false }, queries: { retry: false } },
  });

  return render(
    <SWRConfig value={{ dedupingInterval: 0, provider: () => new Map() }}>
      <QueryClientProvider client={queryClient}>
        <ApiKey />
      </QueryClientProvider>
    </SWRConfig>,
  );
};

beforeEach(() => {
  vi.clearAllMocks();
  hoisted.state.activeWorkspaceId = null;
  hoisted.state.allowed = true;
  hoisted.state.manageSettingsAllowed = true;
  hoisted.state.reason = '';
  hoisted.trpc.getApiKeys.mockResolvedValue([makeItem()]);
  hoisted.trpc.createApiKey.mockResolvedValue({});
  hoisted.trpc.updateApiKey.mockResolvedValue({});
  hoisted.trpc.deleteApiKey.mockResolvedValue({});
});

describe('ApiKey', () => {
  it('shows loading, then empty state when the first fetch returns no keys', async () => {
    let resolveList!: (items: ApiKeyItem[]) => void;
    hoisted.trpc.getApiKeys.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveList = resolve;
        }),
    );

    const { container } = renderPage();

    await waitFor(() => expect(container.querySelector('[aria-busy="true"]')).not.toBeNull());
    expect(hoisted.trpc.getApiKeys).toHaveBeenCalledTimes(1);

    resolveList([]);

    expect(await screen.findByText('apikey.list.empty')).toBeInTheDocument();
  });

  it('renders fetched keys with their plaintext for the owner', async () => {
    renderPage();

    expect(await screen.findByText('My Key')).toBeInTheDocument();
    expect(screen.getByText('lb-plain-secret')).toBeInTheDocument();
    expect(screen.getByRole('switch')).toBeChecked();
  });

  it('creates a key through the modal and refreshes the list', async () => {
    renderPage();
    await screen.findByText('My Key');

    fireEvent.click(screen.getByRole('button', { name: 'apikey.list.actions.create' }));

    expect(hoisted.createApiKeyModal).toHaveBeenCalledTimes(1);
    const { onSubmit } = hoisted.createApiKeyModal.mock.calls[0][0] as {
      onSubmit: (values: CreateApiKeyParams) => Promise<void>;
    };

    await onSubmit({ expiresAt: null, name: 'new key' });

    expect(hoisted.trpc.createApiKey).toHaveBeenCalledWith({ expiresAt: null, name: 'new key' });
    await waitFor(() => expect(hoisted.trpc.getApiKeys).toHaveBeenCalledTimes(2));
  });

  it('renames a key and refreshes the list', async () => {
    renderPage();
    await screen.findByText('My Key');

    fireEvent.click(screen.getByRole('button', { name: 'edit-text' }));

    await waitFor(() =>
      expect(hoisted.trpc.updateApiKey).toHaveBeenCalledWith({
        id: 'key-1',
        value: { name: 'renamed' },
      }),
    );
    await waitFor(() => expect(hoisted.trpc.getApiKeys).toHaveBeenCalledTimes(2));
  });

  it('toggles a key off and refreshes the list', async () => {
    renderPage();
    await screen.findByText('My Key');

    fireEvent.click(screen.getByRole('switch'));

    await waitFor(() =>
      expect(hoisted.trpc.updateApiKey).toHaveBeenCalledWith({
        id: 'key-1',
        value: { enabled: false },
      }),
    );
    await waitFor(() => expect(hoisted.trpc.getApiKeys).toHaveBeenCalledTimes(2));
  });

  it('deletes a key after Popconfirm confirmation and refreshes the list', async () => {
    renderPage();
    await screen.findByText('My Key');

    fireEvent.click(screen.getByRole('button', { name: 'apikey.list.actions.delete' }));

    await screen.findByText('apikey.list.actions.deleteConfirm.title');
    fireEvent.click(
      screen.getByRole('button', { name: 'apikey.list.actions.deleteConfirm.actions.ok' }),
    );

    await waitFor(() => expect(hoisted.trpc.deleteApiKey).toHaveBeenCalledWith({ id: 'key-1' }));
    await waitFor(() => expect(hoisted.trpc.getApiKeys).toHaveBeenCalledTimes(2));
  });

  it('shows the permission toast on forbidden errors without refreshing', async () => {
    hoisted.trpc.updateApiKey.mockRejectedValue({ data: { code: 'FORBIDDEN' } });
    renderPage();
    await screen.findByText('My Key');

    fireEvent.click(screen.getByRole('switch'));

    await waitFor(() => expect(hoisted.message.error).toHaveBeenCalledWith('manageOnlyCreator'));
    expect(hoisted.trpc.getApiKeys).toHaveBeenCalledTimes(1);
  });

  it('shows the generic toast on other mutation errors without refreshing', async () => {
    hoisted.trpc.updateApiKey.mockRejectedValue(new Error('boom'));
    renderPage();
    await screen.findByText('My Key');

    fireEvent.click(screen.getByRole('switch'));

    await waitFor(() => expect(hoisted.message.error).toHaveBeenCalledWith('operationFailed'));
    expect(hoisted.trpc.getApiKeys).toHaveBeenCalledTimes(1);
  });

  it('disables create and every row action without create_content permission', async () => {
    hoisted.state.allowed = false;
    hoisted.state.reason = 'no-permission';
    renderPage();
    await screen.findByText('My Key');

    expect(screen.getByRole('button', { name: 'apikey.list.actions.create' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'edit-text' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'edit-date' })).toBeDisabled();
    expect(screen.getByRole('switch')).toBeDisabled();
    expect(screen.getByRole('button', { name: 'no-permission' })).toBeDisabled();
  });

  it('allows a workspace admin to manage another member key while keeping its secret masked', async () => {
    hoisted.state.activeWorkspaceId = 'ws-1';
    hoisted.trpc.getApiKeys.mockResolvedValue([
      makeItem(),
      makeItem({ id: 'key-2', isMine: false, key: '', name: 'Other Key', userId: 'other' }),
    ]);
    renderPage();
    await screen.findByText('Other Key');

    const otherRow = screen.getByText('Other Key').closest('tr')!;
    expect(within(otherRow).getByText(`lb-${'*'.repeat(12)}`)).toBeInTheDocument();
    expect(within(otherRow).getByRole('button', { name: 'edit-text' })).toBeEnabled();
    expect(within(otherRow).getByRole('switch')).toBeEnabled();
    expect(
      within(otherRow).getByRole('button', { name: 'apikey.list.actions.delete' }),
    ).toBeEnabled();

    const mineRow = screen.getByText('My Key').closest('tr')!;
    expect(within(mineRow).getByText('lb-plain-secret')).toBeInTheDocument();
    expect(within(mineRow).getByRole('button', { name: 'edit-text' })).toBeEnabled();
    expect(within(mineRow).getByRole('switch')).toBeEnabled();
  });

  it('disables create and row actions for workspace members without settings permission', async () => {
    hoisted.state.activeWorkspaceId = 'ws-1';
    hoisted.state.manageSettingsAllowed = false;
    renderPage();
    await screen.findByText('My Key');

    expect(screen.getByRole('button', { name: 'apikey.list.actions.create' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'edit-text' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'edit-date' })).toBeDisabled();
    expect(screen.getByRole('switch')).toBeDisabled();
    expect(screen.getByRole('button', { name: 'manageOnlyCreator' })).toBeDisabled();
  });

  it('shows the unavailable copy with tooltip when key decryption failed', async () => {
    hoisted.trpc.getApiKeys.mockResolvedValue([makeItem({ keyDecryptionFailed: true })]);
    renderPage();

    const unavailable = await screen.findByText('apikey.display.unavailable');
    expect(unavailable).toHaveAttribute('title', 'apikey.display.unavailableDescription');
  });

  it('shows the creator column only in workspace mode', async () => {
    hoisted.state.activeWorkspaceId = 'ws-1';
    hoisted.trpc.getApiKeys.mockResolvedValue([
      makeItem({ creator: 'Bob', isMine: false, key: '', userId: 'other' }),
    ]);
    renderPage();

    expect(
      await screen.findByRole('columnheader', { name: 'apikey.list.columns.creator' }),
    ).toBeInTheDocument();
    expect(screen.getByText('Bob')).toBeInTheDocument();
  });

  it('hides the creator column in personal mode', async () => {
    renderPage();
    await screen.findByText('My Key');

    expect(screen.queryByRole('columnheader', { name: 'apikey.list.columns.creator' })).toBeNull();
  });
});
