/**
 * @vitest-environment happy-dom
 */
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
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

vi.mock('@lobehub/ui/base-ui', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  toast: {
    error: toastErrorMock,
    success: toastSuccessMock,
  },
}));

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
    await user.type(screen.getByPlaceholderText('127.0.0.1'), '127.0.0.1');
    await user.type(screen.getByPlaceholderText('7890'), '7890');
    await user.click(screen.getByRole('button', { name: 'proxy.resetButton' }));

    await waitFor(() => {
      expect(screen.queryByRole('button', { name: 'proxy.resetButton' })).not.toBeInTheDocument();
      expect(screen.getByPlaceholderText('127.0.0.1')).toHaveValue('');
      expect(screen.getByPlaceholderText('7890')).toHaveValue('');
    });
  });

  it('renders auth fields and blocks saving when proxy credentials are missing', async () => {
    const user = userEvent.setup({ delay: null });

    render(<ProxyForm />);

    await user.click(screen.getAllByRole('switch')[0]);
    await user.type(screen.getByPlaceholderText('127.0.0.1'), '127.0.0.1');
    await user.type(screen.getByPlaceholderText('7890'), '7890');
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
    await user.type(screen.getByPlaceholderText('127.0.0.1'), '127.0.0.1');
    await user.type(screen.getByPlaceholderText('7890'), '70000');
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
    await user.type(screen.getByPlaceholderText('127.0.0.1'), '127.0.0.1');
    await user.type(screen.getByPlaceholderText('7890'), '7890');
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
    await user.type(screen.getByPlaceholderText('127.0.0.1'), '127.0.0.1');
    await user.type(screen.getByPlaceholderText('7890'), '7890');

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
    await user.type(screen.getByPlaceholderText('127.0.0.1'), '127.0.0.1');
    await user.type(screen.getByPlaceholderText('7890'), '7890');
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
    await user.type(screen.getByPlaceholderText('127.0.0.1'), '127.0.0.1');
    await user.type(screen.getByPlaceholderText('7890'), '7890');
    await user.click(screen.getByRole('button', { name: 'proxy.testButton' }));

    await waitFor(() => {
      expect(toastErrorMock).toHaveBeenCalledWith('proxy.testFailed: connect ECONNREFUSED');
    });
  });
}, 10000);
