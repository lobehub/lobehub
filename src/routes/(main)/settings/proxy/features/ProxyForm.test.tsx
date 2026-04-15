/**
 * @vitest-environment happy-dom
 */
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ComponentProps, ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import ProxyForm from './ProxyForm';

const setProxySettingsMock = vi.hoisted(() => vi.fn());
const testProxyConfigMock = vi.hoisted(() => vi.fn());
const toastErrorMock = vi.hoisted(() => vi.fn());
const toastSuccessMock = vi.hoisted(() => vi.fn());

const defaultProxySettings = {
  enableProxy: false,
  proxyBypass: 'localhost, 127.0.0.1, ::1',
  proxyPort: '',
  proxyRequireAuth: false,
  proxyServer: '',
  proxyType: 'http',
} as const;

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

vi.mock('@/services/electron/settings', () => ({
  desktopSettingsService: {
    testProxyConfig: testProxyConfigMock,
  },
}));

vi.mock('@/store/electron', () => ({
  useElectronStore: (selector: (state: Record<string, unknown>) => unknown) =>
    selector({
      setProxySettings: setProxySettingsMock,
      useGetProxySettings: () => ({
        data: defaultProxySettings,
        isLoading: false,
      }),
    }),
}));

vi.mock('./SaveBar', () => ({
  default: ({
    isDirty,
    isSaving,
    onReset,
    onSave,
  }: {
    isDirty: boolean;
    isSaving: boolean;
    onReset: () => void;
    onSave: () => void;
  }) =>
    isDirty ? (
      <div>
        <button disabled={isSaving} onClick={onReset}>
          proxy.resetButton
        </button>
        <button disabled={isSaving} onClick={onSave}>
          proxy.saveButton
        </button>
      </div>
    ) : null,
}));

vi.mock('@lobehub/ui', async () => {
  const { Form: AntdForm } = await import('antd');

  const GroupedForm = Object.assign(
    ({
      form,
      initialValues,
      items,
      onValuesChange,
    }: {
      form?: ReturnType<typeof AntdForm.useForm>[0];
      initialValues?: Record<string, string | boolean | undefined>;
      items: Array<{
        children: Array<{
          children: ReactNode;
          label?: ReactNode;
          name?: string;
          rules?: ComponentProps<typeof AntdForm.Item>['rules'];
          valuePropName?: string;
        }>;
      }>;
      onValuesChange?: (
        changedValues: Record<string, unknown>,
        values: Record<string, unknown>,
      ) => void;
    }) => (
      <AntdForm form={form} initialValues={initialValues} onValuesChange={onValuesChange}>
        {items.map((group, groupIndex) => (
          <div key={groupIndex}>
            {group.children.map((item, itemIndex) =>
              item.name ? (
                <AntdForm.Item
                  key={`${groupIndex}-${item.name}-${itemIndex}`}
                  label={item.label}
                  name={item.name}
                  rules={item.rules}
                  valuePropName={item.valuePropName}
                >
                  {item.children}
                </AntdForm.Item>
              ) : (
                <div key={`${groupIndex}-${itemIndex}`}>
                  {item.label ? <div>{item.label}</div> : null}
                  {item.children}
                </div>
              ),
            )}
          </div>
        ))}
      </AntdForm>
    ),
    { useForm: AntdForm.useForm },
  );

  return {
    Form: GroupedForm,
    Skeleton: () => <div>loading</div>,
    toast: {
      error: toastErrorMock,
      success: toastSuccessMock,
    },
  };
});

describe('ProxyForm', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setProxySettingsMock.mockResolvedValue(undefined);
    testProxyConfigMock.mockResolvedValue({ success: true });
  });

  it('keeps enable toggle as an unsaved state when proxy config is incomplete', async () => {
    const user = userEvent.setup();

    render(<ProxyForm />);

    await user.click(screen.getAllByRole('switch')[0]);

    await waitFor(() => {
      expect(setProxySettingsMock).not.toHaveBeenCalled();
      expect(toastErrorMock).not.toHaveBeenCalled();
      expect(screen.getByRole('button', { name: 'proxy.saveButton' })).toBeInTheDocument();
    });
  });

  it('blocks saving when enabled proxy settings are incomplete', async () => {
    const user = userEvent.setup();

    render(<ProxyForm />);

    await user.click(screen.getAllByRole('switch')[0]);
    await user.click(await screen.findByRole('button', { name: 'proxy.saveButton' }));

    await waitFor(() => {
      expect(setProxySettingsMock).not.toHaveBeenCalled();
      expect(screen.getByText('proxy.validation.serverRequired')).toBeInTheDocument();
      expect(screen.getByText('proxy.validation.portRequired')).toBeInTheDocument();
    });
  });

  it('does not convert form validation failures into a generic test toast', async () => {
    const user = userEvent.setup();

    render(<ProxyForm />);

    await user.click(screen.getAllByRole('switch')[0]);
    await user.click(screen.getByRole('button', { name: 'proxy.testButton' }));

    await waitFor(() => {
      expect(testProxyConfigMock).not.toHaveBeenCalled();
      expect(screen.getByText('proxy.validation.serverRequired')).toBeInTheDocument();
      expect(screen.getByText('proxy.validation.portRequired')).toBeInTheDocument();
    });

    expect(toastErrorMock).not.toHaveBeenCalled();
  });
});
