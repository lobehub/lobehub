import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { SWRConfig } from 'swr';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { type ApiKeyItem, type CreateApiKeyParams } from '@/types/apiKey';

import { WorkspaceApiKeyPolicyContext } from '../WorkspaceApiKeyPolicyContext';
import ApiKey from './ApiKey';
import ScopeSelector from './ApiKeyModal/ScopeSelector';

const hoisted = vi.hoisted(() => ({
  createApiKeyModal: vi.fn(),
  state: {
    activeWorkspaceId: null as string | null,
    allowed: true,
    canCreateWorkspaceKey: true,
    isWorkspaceAdmin: true,
    manageSettingsAllowed: true,
    reason: '',
  },
  trpc: {
    createApiKey: vi.fn(),
    deleteApiKey: vi.fn(),
    getApiKeys: vi.fn(),
    updateApiKey: vi.fn(),
  },
  toast: { error: vi.fn(), success: vi.fn(), warning: vi.fn() },
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('@lobehub/ui/base-ui', () => {
  return {
    Button: ({ children, ...props }: ButtonHTMLAttributes<HTMLButtonElement>) => (
      <button {...props}>{children}</button>
    ),
    Drawer: ({
      children,
      onClose,
      open,
      title,
    }: {
      children?: ReactNode;
      onClose?: () => void;
      open?: boolean;
      title?: ReactNode;
    }) =>
      open ? (
        <div role="dialog">
          <div>{title}</div>
          <button type="button" onClick={onClose}>
            close-drawer
          </button>
          {children}
        </div>
      ) : null,
    Switch: ({
      checked,
      disabled,
      onChange,
    }: {
      checked?: boolean;
      disabled?: boolean;
      onChange?: (checked: boolean) => void;
      children?: ReactNode;
    }) => (
      <input
        checked={checked}
        disabled={disabled}
        role="switch"
        type="checkbox"
        onChange={(event) => onChange?.(event.currentTarget.checked)}
      />
    ),
    toast: hoisted.toast,
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
        <WorkspaceApiKeyPolicyContext
          value={{
            canCreate: hoisted.state.canCreateWorkspaceKey,
            isAdmin: hoisted.state.isWorkspaceAdmin,
            memberCreation: hoisted.state.canCreateWorkspaceKey ? 'all_members' : 'admins_only',
          }}
        >
          <ApiKey />
        </WorkspaceApiKeyPolicyContext>
      </QueryClientProvider>
    </SWRConfig>,
  );
};

beforeEach(() => {
  vi.clearAllMocks();
  hoisted.state.activeWorkspaceId = null;
  hoisted.state.allowed = true;
  hoisted.state.canCreateWorkspaceKey = true;
  hoisted.state.isWorkspaceAdmin = true;
  hoisted.state.manageSettingsAllowed = true;
  hoisted.state.reason = '';
  hoisted.trpc.getApiKeys.mockResolvedValue([makeItem()]);
  hoisted.trpc.createApiKey.mockResolvedValue({});
  hoisted.trpc.updateApiKey.mockResolvedValue({});
  hoisted.trpc.deleteApiKey.mockResolvedValue({});
});

const openDetail = async (name: string) => {
  fireEvent.click(screen.getByText(name).closest('tr')!);
  return screen.findByRole('dialog');
};

describe('ApiKey', () => {
  it('offers MCP read/write and read-only usage scopes when access is restricted', () => {
    const onSelectedChange = vi.fn();
    render(
      <ScopeSelector
        fullAccess={false}
        selected={[]}
        onFullAccessChange={vi.fn()}
        onSelectedChange={onSelectedChange}
      />,
    );

    const mcpGroup = screen.getByText('apikey.scopes.groups.mcp').parentElement!;
    const usageGroup = screen.getByText('apikey.scopes.groups.usage').parentElement!;
    expect(within(mcpGroup).getAllByRole('checkbox')).toHaveLength(2);
    expect(within(usageGroup).getAllByRole('checkbox')).toHaveLength(1);

    fireEvent.click(within(mcpGroup).getByRole('checkbox', { name: 'apikey.scopes.write' }));
    expect(onSelectedChange).toHaveBeenCalledWith(['mcp:write', 'mcp:read']);
  });

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

  it('explains the creation restriction when a workspace member has no keys', async () => {
    hoisted.state.activeWorkspaceId = 'ws-1';
    hoisted.state.canCreateWorkspaceKey = false;
    hoisted.state.isWorkspaceAdmin = false;
    hoisted.trpc.getApiKeys.mockResolvedValue([]);

    renderPage();

    expect(await screen.findByText('apikey.list.restrictedEmpty.title')).toBeInTheDocument();
    expect(screen.getByText('apikey.list.restrictedEmpty.desc')).toBeInTheDocument();
    expect(screen.queryByText('apikey.list.empty')).toBeNull();
    expect(screen.getByRole('button', { name: 'apikey.list.actions.create' })).toBeDisabled();
  });

  it('renders fetched keys with their plaintext for the owner', async () => {
    renderPage();

    expect(await screen.findByText('My Key')).toBeInTheDocument();
    expect(screen.getByText('lb-plain-secret')).toBeInTheDocument();
    // management controls live in the drawer, not on the row
    expect(screen.queryByRole('switch')).toBeNull();
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

    const dialog = await openDetail('My Key');
    fireEvent.click(within(dialog).getByRole('button', { name: 'edit-text' }));

    await waitFor(() =>
      expect(hoisted.trpc.updateApiKey).toHaveBeenCalledWith({
        id: 'key-1',
        value: { name: 'renamed' },
      }),
    );
    await waitFor(() => expect(hoisted.trpc.getApiKeys).toHaveBeenCalledTimes(2));
  });

  it('toggles a key off from the detail drawer and refreshes the list', async () => {
    renderPage();
    await screen.findByText('My Key');

    const dialog = await openDetail('My Key');
    fireEvent.click(within(dialog).getByRole('switch'));

    await waitFor(() =>
      expect(hoisted.trpc.updateApiKey).toHaveBeenCalledWith({
        id: 'key-1',
        value: { enabled: false },
      }),
    );
    await waitFor(() => expect(hoisted.trpc.getApiKeys).toHaveBeenCalledTimes(2));
  });

  it('deletes a key from the detail drawer after Popconfirm confirmation', async () => {
    renderPage();
    await screen.findByText('My Key');

    const dialog = await openDetail('My Key');
    fireEvent.click(within(dialog).getByRole('button', { name: 'apikey.list.actions.delete' }));

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

    const dialog = await openDetail('My Key');
    fireEvent.click(within(dialog).getByRole('switch'));

    await waitFor(() => expect(hoisted.toast.error).toHaveBeenCalledWith('manageOnlyCreator'));
    expect(hoisted.trpc.getApiKeys).toHaveBeenCalledTimes(1);
  });

  it('shows the generic toast on other mutation errors without refreshing', async () => {
    hoisted.trpc.updateApiKey.mockRejectedValue(new Error('boom'));
    renderPage();
    await screen.findByText('My Key');

    const dialog = await openDetail('My Key');
    fireEvent.click(within(dialog).getByRole('switch'));

    await waitFor(() => expect(hoisted.toast.error).toHaveBeenCalledWith('operationFailed'));
    expect(hoisted.trpc.getApiKeys).toHaveBeenCalledTimes(1);
  });

  it('disables create and every row action without create_content permission', async () => {
    hoisted.state.allowed = false;
    hoisted.state.reason = 'no-permission';
    renderPage();
    await screen.findByText('My Key');

    expect(screen.getByRole('button', { name: 'apikey.list.actions.create' })).toBeDisabled();

    // the drawer carries the whole management surface, so it must be gated
    const dialog = await openDetail('My Key');
    expect(within(dialog).getByRole('button', { name: 'edit-text' })).toBeDisabled();
    expect(within(dialog).getByRole('button', { name: 'edit-date' })).toBeDisabled();
    expect(within(dialog).getByRole('switch')).toBeDisabled();
    expect(
      within(dialog).getByRole('button', { name: 'apikey.list.actions.delete' }),
    ).toBeDisabled();
  });

  it('allows a workspace admin to revoke another member key while keeping it read-only and masked', async () => {
    hoisted.state.activeWorkspaceId = 'ws-1';
    hoisted.trpc.getApiKeys.mockResolvedValue([
      makeItem(),
      makeItem({ id: 'key-2', isMine: false, key: '', name: 'Other Key', userId: 'other' }),
    ]);
    renderPage();
    await screen.findByText('Other Key');

    const otherRow = screen.getByText('Other Key').closest('tr')!;
    expect(within(otherRow).getByText(`sk-lh-${'*'.repeat(12)}`)).toBeInTheDocument();

    // an admin can centrally revoke another member's key, but only its creator
    // can rename, disable, or edit the grants.
    const dialog = await openDetail('Other Key');
    expect(within(dialog).getByRole('button', { name: 'edit-text' })).toBeDisabled();
    expect(within(dialog).getByRole('switch')).toBeDisabled();
    expect(
      within(dialog).queryByRole('button', { name: 'apikey.detail.permissions.edit' }),
    ).toBeNull();
    expect(
      within(dialog).getByRole('button', { name: 'apikey.list.actions.delete' }),
    ).toBeEnabled();
    // ...but its secret stays masked there too
    expect(within(dialog).getByText(`sk-lh-${'*'.repeat(12)}`)).toBeInTheDocument();

    const mineRow = screen.getByText('My Key').closest('tr')!;
    expect(within(mineRow).getByText('lb-plain-secret')).toBeInTheDocument();
  });

  it('allows workspace members to create and manage their own keys', async () => {
    hoisted.state.activeWorkspaceId = 'ws-1';
    hoisted.state.manageSettingsAllowed = false;
    hoisted.state.isWorkspaceAdmin = false;
    renderPage();
    await screen.findByText('My Key');

    expect(screen.getByRole('button', { name: 'apikey.list.actions.create' })).toBeEnabled();

    const dialog = await openDetail('My Key');
    expect(within(dialog).getByRole('button', { name: 'edit-text' })).toBeEnabled();
    expect(within(dialog).getByRole('switch')).toBeEnabled();
    expect(
      within(dialog).getByRole('button', { name: 'apikey.list.actions.delete' }),
    ).toBeEnabled();
  });

  it('disables member creation when the workspace policy is admins only', async () => {
    hoisted.state.activeWorkspaceId = 'ws-1';
    hoisted.state.canCreateWorkspaceKey = false;
    hoisted.state.isWorkspaceAdmin = false;
    renderPage();
    await screen.findByText('My Key');

    const createButton = screen.getByRole('button', { name: 'apikey.list.actions.create' });
    expect(createButton).toBeDisabled();
    expect(createButton).toHaveAttribute('title', 'apikey.list.actions.creationRestricted');
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

  it('hides the creator column from workspace members', async () => {
    hoisted.state.activeWorkspaceId = 'ws-1';
    hoisted.state.isWorkspaceAdmin = false;
    renderPage();
    await screen.findByText('My Key');

    expect(screen.queryByRole('columnheader', { name: 'apikey.list.columns.creator' })).toBeNull();
  });

  it('hides the creator column in personal mode', async () => {
    renderPage();
    await screen.findByText('My Key');

    expect(screen.queryByRole('columnheader', { name: 'apikey.list.columns.creator' })).toBeNull();
  });

  it('keeps scopes out of the list — they live in the detail drawer', async () => {
    hoisted.trpc.getApiKeys.mockResolvedValue([makeItem({ scopes: ['agent:read'] })]);
    renderPage();
    await screen.findByText('My Key');

    expect(screen.queryByRole('columnheader', { name: 'apikey.list.columns.scopes' })).toBeNull();
    expect(screen.getByText('My Key').closest('tr')!.textContent).not.toContain(
      'apikey.scopes.groups.agent',
    );
  });

  it('opens the detail drawer on row click listing only the granted scopes', async () => {
    hoisted.trpc.getApiKeys.mockResolvedValue([
      makeItem({
        scopes: ['model:read', 'model:invoke', 'agent:read', 'mcp:read', 'mcp:write', 'usage:read'],
      }),
    ]);
    renderPage();
    await screen.findByText('My Key');

    fireEvent.click(screen.getByText('My Key').closest('tr')!);

    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('apikey.detail.title')).toBeInTheDocument();
    // one row per granted domain, actions collapsed — ungranted domains absent
    expect(within(dialog).getByText('apikey.scopes.groups.agent')).toBeInTheDocument();
    expect(within(dialog).getByText('apikey.scopes.groups.mcp')).toBeInTheDocument();
    expect(within(dialog).getByText('apikey.scopes.groups.model')).toBeInTheDocument();
    expect(within(dialog).getByText('apikey.scopes.groups.usage')).toBeInTheDocument();
    expect(within(dialog).queryByText('apikey.scopes.groups.chat')).toBeNull();
    expect(within(dialog).queryByText('apikey.scopes.groups.file')).toBeNull();
    // the model row collapses read + invoke onto one line (the `t` mock echoes
    // keys, so the join/separator appear as their key names)
    expect(dialog.textContent).toContain(
      [
        'apikey.scopes.groups.model',
        'apikey.scopes.grantJoin',
        'apikey.scopes.read',
        'apikey.scopes.separator',
        'apikey.scopes.invoke',
      ].join(''),
    );
    // the grant summary stays compact until the creator explicitly edits it
    expect(within(dialog).queryAllByRole('checkbox')).toHaveLength(0);
    expect(
      within(dialog).getByRole('button', { name: 'apikey.detail.permissions.edit' }),
    ).toBeEnabled();
  });

  it('edits a key scope in place and refreshes the list', async () => {
    hoisted.trpc.getApiKeys.mockResolvedValue([makeItem({ scopes: ['agent:read'] })]);
    renderPage();
    await screen.findByText('My Key');

    const dialog = await openDetail('My Key');
    fireEvent.click(within(dialog).getByRole('button', { name: 'apikey.detail.permissions.edit' }));
    const scopeCheckboxes = within(dialog).getAllByRole('checkbox');
    fireEvent.click(scopeCheckboxes[0]);
    fireEvent.click(scopeCheckboxes[2]);
    fireEvent.click(within(dialog).getByRole('button', { name: 'apikey.detail.permissions.save' }));

    await waitFor(() =>
      expect(hoisted.trpc.updateApiKey).toHaveBeenCalledWith({
        id: 'key-1',
        value: { scopes: ['chat:read'] },
      }),
    );
    await waitFor(() => expect(hoisted.trpc.getApiKeys).toHaveBeenCalledTimes(2));
  });

  it('shows the full-access copy instead of the grant list for a full-access key', async () => {
    renderPage();
    await screen.findByText('My Key');

    fireEvent.click(screen.getByText('My Key').closest('tr')!);

    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('apikey.scopes.fullAccess')).toBeInTheDocument();
    expect(within(dialog).queryByText('apikey.scopes.groups.agent')).toBeNull();
  });

  it('does not open the drawer when clicking inside the key cell', async () => {
    renderPage();
    await screen.findByText('My Key');

    // the key cell keeps its own reveal/copy controls, so it must not navigate
    fireEvent.click(screen.getByText('lb-plain-secret'));

    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('deletes from the drawer and closes it', async () => {
    renderPage();
    await screen.findByText('My Key');

    const dialog = await openDetail('My Key');

    fireEvent.click(within(dialog).getByRole('button', { name: 'apikey.list.actions.delete' }));
    await screen.findByText('apikey.list.actions.deleteConfirm.title');
    fireEvent.click(
      screen.getByRole('button', { name: 'apikey.list.actions.deleteConfirm.actions.ok' }),
    );

    await waitFor(() => expect(hoisted.trpc.deleteApiKey).toHaveBeenCalledWith({ id: 'key-1' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });
});
