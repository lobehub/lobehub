/**
 * @vitest-environment happy-dom
 */
import type { LobeToolCustomPlugin } from '@lobechat/types';
import { type FormInstance, useForm } from '@lobehub/ui/form';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import MCPManifestForm from './index';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('@/libs/trpc/client', () => ({
  lambdaClient: {
    connector: {
      getRedirectUri: {
        query: vi.fn().mockResolvedValue({ redirectUri: 'https://app.test/oauth/callback' }),
      },
    },
  },
}));

vi.mock('@/store/tool', () => ({
  useToolStore: (selector: (s: Record<string, unknown>) => unknown) =>
    selector({ testMcpConnection: vi.fn() }),
}));

vi.mock('@/store/tool/selectors', () => ({
  mcpStoreSelectors: { getMCPConnectionTestState: () => () => ({}) },
  pluginSelectors: { storeAndInstallPluginsIdList: () => [] },
}));

vi.mock('./QuickImportSection', () => ({ default: () => null }));
vi.mock('./MCPTypeSelect', () => ({ default: () => null }));
vi.mock('./BoundDeviceSelect', () => ({ default: () => null }));
vi.mock('@/components/KeyValueEditor', () => ({ default: () => null }));
vi.mock('@/components/MCPStdioCommandInput', () => ({ default: () => null }));
vi.mock('@/features/MCP/MCPInstallProgress/InstallError/ErrorDetails', () => ({
  default: () => null,
}));

const AUTH_TYPE = 'customParams.mcp.auth.type';

const httpValues = (auth: Record<string, unknown> = { type: 'none' }) =>
  ({
    customParams: { mcp: { auth, type: 'http', url: 'https://mcp.example.com' } },
    identifier: 'box',
  }) as LobeToolCustomPlugin;

const renderForm = (initialValues: LobeToolCustomPlugin) => {
  const ref: { form?: FormInstance<LobeToolCustomPlugin> } = {};
  const Harness = () => {
    const form = useForm<LobeToolCustomPlugin>({ initialValues });
    ref.form = form;
    return <MCPManifestForm enableDeviceBinding enableOAuth form={form} />;
  };
  render(<Harness />);
  return ref as { form: FormInstance<LobeToolCustomPlugin> };
};

const expandAdvanced = () => fireEvent.click(screen.getByText('dev.mcp.advanced.title'));

describe('MCPManifestForm advanced settings', () => {
  it('keeps the auth type outside and the connection route inside the collapsed section', () => {
    renderForm(httpValues({ type: 'oauth2' }));

    expect(screen.getByText('dev.mcp.auth.label')).toBeTruthy();
    expect(screen.getByText('dev.mcp.advanced.title')).toBeTruthy();
    expect(screen.queryByText('dev.mcp.connectVia.label')).toBeNull();
    expect(screen.queryByText('dev.mcp.connectVia.autoDesc')).toBeNull();
    expect(screen.queryByText('dev.mcp.auth.oauth.clientId.label')).toBeNull();
    expect(screen.queryByText('dev.mcp.auth.oauth.clientSecret.label')).toBeNull();
    expect(screen.queryByText('dev.mcp.auth.oauth.redirectHint')).toBeNull();

    expandAdvanced();

    expect(screen.getByText('dev.mcp.connectVia.label')).toBeTruthy();
    expect(screen.getByText('dev.mcp.connectVia.autoDesc')).toBeTruthy();
    expect(screen.getByText('dev.mcp.connectVia.device')).toBeTruthy();
  });

  it('shows the OAuth client fields in the expanded section only while OAuth is chosen', () => {
    const { form } = renderForm(httpValues({ type: 'oauth2' }));
    expandAdvanced();

    // Leaving Client ID empty keeps the CIMD / DCR auto-detection hint
    expect(screen.getByText('dev.mcp.auth.oauth.clientId.label')).toBeTruthy();
    expect(screen.getByText('dev.mcp.auth.oauth.clientId.desc')).toBeTruthy();
    expect(screen.getByText('dev.mcp.auth.oauth.clientSecret.label')).toBeTruthy();
    expect(screen.getByText('dev.mcp.auth.oauth.redirectHint')).toBeTruthy();

    for (const type of ['none', 'bearer']) {
      act(() => form.setValue(AUTH_TYPE, type));

      expect(screen.getByText('dev.mcp.connectVia.label')).toBeTruthy();
      expect(screen.queryByText('dev.mcp.auth.oauth.clientId.label')).toBeNull();
      expect(screen.queryByText('dev.mcp.auth.oauth.redirectHint')).toBeNull();
    }
  });

  it('opens the section for a saved device route and keeps its values once collapsed', () => {
    const { form } = renderForm(httpValues());
    expect(screen.queryByText('dev.mcp.connectVia.label')).toBeNull();

    // Edit mode seeds the form after mount
    act(() =>
      form.setValues({
        customParams: {
          mcp: {
            auth: { clientId: 'client-1', type: 'oauth2' },
            connectVia: 'device',
            type: 'http',
            url: 'https://mcp.example.com',
          },
        },
      } as LobeToolCustomPlugin),
    );

    expect(screen.getByText('dev.mcp.connectVia.deviceDesc')).toBeTruthy();
    expect(screen.getByText('dev.mcp.auth.oauth.clientId.label')).toBeTruthy();

    expandAdvanced();
    expect(screen.queryByText('dev.mcp.connectVia.label')).toBeNull();

    const mcp = form.getValues().customParams?.mcp;
    expect(mcp?.connectVia).toBe('device');
    expect(mcp?.auth).toMatchObject({ clientId: 'client-1', type: 'oauth2' });
  });
});
