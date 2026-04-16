/**
 * @vitest-environment happy-dom
 */
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { FormInstance } from 'antd';
import type { ComponentProps, ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import ProxyForm from './ProxyForm';

interface MockFormValues {
  [key: string]: unknown;
}

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
      form?: FormInstance<MockFormValues>;
      initialValues?: MockFormValues;
      items: Array<{
        children: Array<{
          children: ReactNode;
          label?: ReactNode;
          name?: string;
          rules?: ComponentProps<typeof AntdForm.Item>['rules'];
          valuePropName?: string;
        }>;
      }>;
      onValuesChange?: (changedValues: MockFormValues, values: MockFormValues) => void;
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
    const user = userEvent.setup({ delay: null });

    render(<ProxyForm />);

    await user.click(screen.getAllByRole('switch')[0]);

    await waitFor(() => {
      expect(setProxySettingsMock).not.toHaveBeenCalled();
      expect(toastErrorMock).not.toHaveBeenCalled();
      expect(screen.getByRole('button', { name: 'proxy.saveButton' })).toBeInTheDocument();
    });
  });

  it('blocks saving when enabled proxy settings are incomplete', async () => {
    const user = userEvent.setup({ delay: null });

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
    const user = userEvent.setup({ delay: null });

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

  it('resets unsaved proxy changes back to persisted settings', async () => {
    const user = userEvent.setup({ delay: null });

    render(<ProxyForm />);

    await user.click(screen.getAllByRole('switch')[0]);
    await user.type(screen.getByRole('textbox', { name: 'proxy.server' }), '127.0.0.1');
    await user.type(screen.getByRole('textbox', { name: 'proxy.port' }), '7890');
    await user.click(screen.getByRole('button', { name: 'proxy.resetButton' }));

    await waitFor(() => {
      expect(screen.queryByRole('button', { name: 'proxy.resetButton' })).not.toBeInTheDocument();
      expect(screen.getByRole('textbox', { name: 'proxy.server' })).toHaveValue('');
      expect(screen.getByRole('textbox', { name: 'proxy.port' })).toHaveValue('');
    });
  });

  it('renders auth fields and blocks saving when proxy credentials are missing', async () => {
    const user = userEvent.setup({ delay: null });

    render(<ProxyForm />);

    await user.click(screen.getAllByRole('switch')[0]);
    await user.type(screen.getByRole('textbox', { name: 'proxy.server' }), '127.0.0.1');
    await user.type(screen.getByRole('textbox', { name: 'proxy.port' }), '7890');
    await user.click(screen.getAllByRole('switch')[1]);

    expect(screen.getByPlaceholderText('proxy.username_placeholder')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('proxy.password_placeholder')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'proxy.saveButton' }));

    await waitFor(() => {
      expect(setProxySettingsMock).not.toHaveBeenCalled();
      expect(screen.getByText('proxy.validation.usernameRequired')).toBeInTheDocument();
      expect(screen.getByText('proxy.validation.passwordRequired')).toBeInTheDocument();
    });
  });

  it('blocks saving when the proxy port is outside the valid range', async () => {
    const user = userEvent.setup({ delay: null });

    render(<ProxyForm />);

    await user.click(screen.getAllByRole('switch')[0]);
    await user.type(screen.getByRole('textbox', { name: 'proxy.server' }), '127.0.0.1');
    await user.type(screen.getByRole('textbox', { name: 'proxy.port' }), '70000');
    await user.click(screen.getByRole('button', { name: 'proxy.saveButton' }));

    await waitFor(() => {
      expect(setProxySettingsMock).not.toHaveBeenCalled();
      expect(screen.getByText('proxy.validation.portInvalid')).toBeInTheDocument();
    });
  });

  it('saves a valid proxy configuration from the save bar', async () => {
    const user = userEvent.setup({ delay: null });

    render(<ProxyForm />);

    await user.click(screen.getAllByRole('switch')[0]);
    await user.type(screen.getByRole('textbox', { name: 'proxy.server' }), '127.0.0.1');
    await user.type(screen.getByRole('textbox', { name: 'proxy.port' }), '7890');
    await user.click(screen.getByRole('button', { name: 'proxy.saveButton' }));

    await waitFor(() => {
      expect(setProxySettingsMock).toHaveBeenCalledWith(
        expect.objectContaining({
          enableProxy: true,
          proxyPort: '7890',
          proxyServer: '127.0.0.1',
          proxyType: 'http',
        }),
      );
    });
  });

  it('reverts the enable switch and shows an error when auto-saving fails', async () => {
    const user = userEvent.setup({ delay: null });

    render(<ProxyForm />);

    await user.click(screen.getAllByRole('switch')[0]);
    await user.type(screen.getByRole('textbox', { name: 'proxy.server' }), '127.0.0.1');
    await user.type(screen.getByRole('textbox', { name: 'proxy.port' }), '7890');

    setProxySettingsMock.mockRejectedValueOnce(new Error('boom'));

    await user.click(screen.getAllByRole('switch')[0]);

    await waitFor(() => {
      expect(toastErrorMock).toHaveBeenCalledWith('proxy.saveFailed');
      expect(screen.getAllByRole('switch')[0]).toHaveAttribute('aria-checked', 'true');
    });
  });

  it('tests a valid proxy configuration successfully', async () => {
    const user = userEvent.setup({ delay: null });

    testProxyConfigMock.mockResolvedValue({ responseTime: 42, success: true });

    render(<ProxyForm />);

    await user.click(screen.getAllByRole('switch')[0]);
    await user.type(screen.getByRole('textbox', { name: 'proxy.server' }), '127.0.0.1');
    await user.type(screen.getByRole('textbox', { name: 'proxy.port' }), '7890');
    await user.click(screen.getByRole('button', { name: 'proxy.testButton' }));

    await waitFor(() => {
      expect(testProxyConfigMock).toHaveBeenCalledWith(
        expect.objectContaining({
          enableProxy: true,
          proxyPort: '7890',
          proxyServer: '127.0.0.1',
          proxyType: 'http',
        }),
        'https://www.google.com',
      );
      expect(toastSuccessMock).toHaveBeenCalledWith('proxy.testSuccessWithTime');
    });
  });

  it('surfaces proxy connectivity failures from the test action', async () => {
    const user = userEvent.setup({ delay: null });

    testProxyConfigMock.mockResolvedValue({ message: 'connect ECONNREFUSED', success: false });

    render(<ProxyForm />);

    await user.click(screen.getAllByRole('switch')[0]);
    await user.type(screen.getByRole('textbox', { name: 'proxy.server' }), '127.0.0.1');
    await user.type(screen.getByRole('textbox', { name: 'proxy.port' }), '7890');
    await user.click(screen.getByRole('button', { name: 'proxy.testButton' }));

    await waitFor(() => {
      expect(toastErrorMock).toHaveBeenCalledWith('proxy.testFailed: connect ECONNREFUSED');
    });
  });
}, 10000);
