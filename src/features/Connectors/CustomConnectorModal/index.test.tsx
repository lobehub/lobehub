/**
 * @vitest-environment happy-dom
 */
import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import CustomConnectorModal from './index';

const mocks = vi.hoisted(() => ({
  state: {
    connector: undefined as unknown,
    createConnector: vi.fn(),
    deleteConnector: vi.fn(),
    getConnectorForEdit: vi.fn(),
    startConnectorOAuth: vi.fn(),
    syncConnectorTools: vi.fn(),
    uninstallCustomPlugin: vi.fn(),
    updateConnector: vi.fn(),
  },
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, options?: { defaultValue?: string } | string) =>
      typeof options === 'object' ? (options.defaultValue ?? _key) : (options ?? _key),
  }),
}));

vi.mock('@/store/tool', () => ({
  useToolStore: (selector: (state: typeof mocks.state) => unknown) => selector(mocks.state),
}));

vi.mock('@/store/tool/slices/connector', () => ({
  connectorSelectors: {
    connectorById: () => (state: typeof mocks.state) => state.connector,
  },
}));

// The form itself is a heavy antd form; what matters here is the value the
// modal seeds it with.
vi.mock('@/features/PluginDevModal', () => ({
  default: ({ value }: { value?: unknown }) => (
    <div data-testid="seed">{JSON.stringify(value ?? null)}</div>
  ),
}));

vi.mock('@/utils/connectorOAuth', () => ({ waitForConnectorOAuth: vi.fn() }));

/**
 * The persisted list projection strips `mcpStdioConfig.env` and
 * `metadata.customHeaders` (see `withoutConnectorSecrets`). A row hydrated from
 * IndexedDB therefore has neither, and the edit form has to take them from the
 * protected `getForEdit` read — otherwise it seeds empty secret fields and
 * saving the apparently untouched form deletes them.
 */
describe('CustomConnectorModal edit pre-fill', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Exactly what a hydrated list row looks like: no stdio env, no headers.
    mocks.state.connector = {
      id: 'c1',
      identifier: 'my-mcp',
      mcpConnectionType: 'stdio',
      mcpServerUrl: null,
      metadata: { description: 'My MCP' },
      name: 'My MCP',
      sourceType: 'custom',
    };
    mocks.state.getConnectorForEdit.mockResolvedValue({
      credentials: null,
      mcpStdioConfig: { args: ['-y'], command: 'npx', env: { API_KEY: 'sk-live-secret' } },
      metadata: { customHeaders: { Authorization: 'Bearer header-secret' }, description: 'My MCP' },
      oidcConfig: null,
    });
  });

  it('seeds the stdio env and custom headers from the protected edit read', async () => {
    render(<CustomConnectorModal open connectorId="c1" onClose={() => {}} />);

    await waitFor(() => expect(screen.getByTestId('seed').textContent).not.toBe('null'));

    const seeded = JSON.parse(screen.getByTestId('seed').textContent!);
    expect(seeded.customParams.mcp.env).toEqual({ API_KEY: 'sk-live-secret' });
    expect(seeded.customParams.mcp.headers).toEqual({ Authorization: 'Bearer header-secret' });
    expect(seeded.customParams.mcp.command).toBe('npx');
  });

  it('falls back to the list row only when the edit read omits the field', async () => {
    mocks.state.connector = {
      ...(mocks.state.connector as object),
      mcpStdioConfig: { command: 'uvx', env: { LEGACY: 'from-row' } },
    };
    // `undefined` = an older read that does not ship the field at all.
    mocks.state.getConnectorForEdit.mockResolvedValue({
      credentials: null,
      metadata: undefined,
      oidcConfig: null,
    });

    render(<CustomConnectorModal open connectorId="c1" onClose={() => {}} />);

    await waitFor(() => expect(screen.getByTestId('seed').textContent).not.toBe('null'));

    const seeded = JSON.parse(screen.getByTestId('seed').textContent!);
    expect(seeded.customParams.mcp.env).toEqual({ LEGACY: 'from-row' });
  });

  // `null` from the protected read is the server confirming there is nothing —
  // not "field missing". A row cached by this browser can be older than the
  // connector (re-created or cleared in another session), so it must not
  // resurrect secrets that the read says are gone.
  it('treats an explicit null from the edit read as authoritative', async () => {
    mocks.state.connector = {
      ...(mocks.state.connector as object),
      metadata: { customHeaders: { Authorization: 'stale-header' }, description: 'Stale' },
      mcpStdioConfig: { command: 'uvx', env: { STALE: 'from-row' } },
    };
    mocks.state.getConnectorForEdit.mockResolvedValue({
      credentials: null,
      mcpStdioConfig: null,
      metadata: null,
      oidcConfig: null,
    });

    render(<CustomConnectorModal open connectorId="c1" onClose={() => {}} />);

    await waitFor(() => expect(screen.getByTestId('seed').textContent).not.toBe('null'));

    const seeded = JSON.parse(screen.getByTestId('seed').textContent!);
    expect(seeded.customParams.mcp.env).toBeUndefined();
    expect(seeded.customParams.mcp.command).toBeUndefined();
    expect(seeded.customParams.mcp.headers).toBeUndefined();
    expect(seeded.customParams.description).toBeUndefined();
  });
});

/**
 * Only a client the user registered by hand belongs in the Client ID field. A
 * client the server resolved itself (a Client ID Metadata Document URL or a
 * DCR-issued id) must stay out: saving the form would otherwise relabel it as
 * pre-registration — pinning the CIMD URL and dropping the DCR secret the form
 * never received.
 */
describe('CustomConnectorModal OAuth client pre-fill', () => {
  const seedFor = async (oidcConfig: Record<string, unknown>) => {
    mocks.state.connector = {
      id: 'c1',
      identifier: 'my-mcp',
      mcpConnectionType: 'http',
      mcpServerUrl: 'https://mcp.example.com/mcp',
      metadata: {},
      name: 'My MCP',
      sourceType: 'custom',
    };
    mocks.state.getConnectorForEdit.mockResolvedValue({
      credentials: null,
      mcpStdioConfig: null,
      metadata: {},
      oidcConfig,
    });

    render(<CustomConnectorModal open connectorId="c1" onClose={() => {}} />);
    await waitFor(() => expect(screen.getByTestId('seed').textContent).not.toBe('null'));
    return JSON.parse(screen.getByTestId('seed').textContent!).customParams.mcp.auth;
  };

  beforeEach(() => vi.clearAllMocks());

  it('shows a pre-registered client ID', async () => {
    const auth = await seedFor({ clientId: 'my-app', scheme: 'pre_registration' });
    expect(auth).toMatchObject({ clientId: 'my-app', type: 'oauth2' });
  });

  it.each([
    ['client_id_metadata_document', 'https://app.example.com/oauth/connector/client-metadata.json'],
    ['dcr', 'dcr-issued-id'],
  ])('leaves the field empty for a %s client', async (scheme, clientId) => {
    const auth = await seedFor({ clientId, scheme });
    expect(auth.type).toBe('oauth2');
    expect(auth.clientId).toBeUndefined();
  });
});
