import type { DataSyncConfig } from '@lobechat/electron-client-ipc';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockElectronState = vi.hoisted(() => ({
  clearRemoteServerSyncError: vi.fn(),
  connectRemoteServer: vi.fn(),
  dataSyncConfig: { active: true, storageMode: 'cloud' } as DataSyncConfig,
  isConnectingServer: false,
  refreshServerConfig: vi.fn(),
  remoteServerSyncError: undefined as { message?: string } | undefined,
  useDataSyncConfig: vi.fn(() => ({})),
}));

const mockSignOut = vi.hoisted(() => vi.fn());

vi.mock('@lobechat/electron-client-ipc', () => ({
  useWatchBroadcast: vi.fn(),
}));

vi.mock('@lobehub/ui', () => {
  const Button = ({
    children,
    disabled,
    onClick,
  }: {
    children: ReactNode;
    disabled?: boolean;
    onClick?: () => void;
  }) => (
    <button disabled={disabled} type="button" onClick={onClick}>
      {children}
    </button>
  );

  return {
    Alert: ({ description, title }: { description?: ReactNode; title?: ReactNode }) => (
      <section>
        <h2>{title}</h2>
        <p>{description}</p>
      </section>
    ),
    Button,
    Center: ({ children }: { children: ReactNode }) => <div>{children}</div>,
    Flexbox: ({ children }: { children: ReactNode }) => <div>{children}</div>,
    Icon: () => <span />,
    Input: (props: React.InputHTMLAttributes<HTMLInputElement>) => <input {...props} />,
    Text: ({ as, children }: { as?: 'p' | 'span'; children: ReactNode }) =>
      as === 'p' ? <p>{children}</p> : <span>{children}</span>,
  };
});

vi.mock('antd', () => ({
  Divider: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

vi.mock('antd-style', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;

  return {
    ...actual,
    createStaticStyles: () => ({}),
    cssVar: {
      colorFillSecondary: '#eee',
      colorTextDescription: '#888',
      colorTextSecondary: '#666',
    },
  };
});

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: string | Record<string, string>) => {
      const dict: Record<string, string> = {
        'authResult.failed.desc': 'Authorization failed',
        'authResult.failed.title': 'Authorization Failed',
        // Retired key, kept so the "no success banner" assertion below can still fail loudly
        'authResult.success.title': 'Authorization Successful',
        'back': 'Back',
        'next': 'Next',
        'screen5.actions.cancel': 'Cancel',
        'screen5.actions.connectToServer': 'Connect to server',
        'screen5.actions.done': 'Done',
        'screen5.actions.signInCloud': 'Sign in Cloud',
        'screen5.actions.signOut': 'Sign out',
        'screen5.actions.tryAgain': 'Try again',
        'screen5.description':
          'Sign in to sync Agents, Groups, settings, and Context across all devices.',
        'screen5.methods.selfhost.description': 'Use self-hosted server',
        'screen5.selfhost.endpointPlaceholder': 'https://example.com',
        'screen5.status.cloud.title': 'Connected to LobeHub Cloud',
        'screen5.status.description': 'Everything is syncing across all your devices.',
        'screen5.status.selfhost.description': 'Syncing with {{url}}.',
        'screen5.status.selfhost.title': 'Connected to your own server',
        'screen5.title': 'Sign in to sync across devices',
        'screen5.title2': '',
        'screen5.title3': '',
      };

      const template = dict[key] ?? (typeof options === 'string' ? options : key);

      if (!options || typeof options === 'string') return template;

      return Object.entries(options).reduce(
        (acc, [name, value]) => acc.replaceAll(`{{${name}}}`, value),
        template,
      );
    },
  }),
}));

vi.mock('@/const/version', () => ({
  isDesktop: true,
}));

vi.mock('@/features/User/UserInfo', () => ({
  default: () => <div>User Info</div>,
}));

vi.mock('@/hooks/useIMECompositionEvent', () => ({
  useIMECompositionEvent: () => ({
    compositionProps: {},
    isComposingRef: { current: false },
  }),
}));

vi.mock('@/hooks/useSignOut', () => ({
  useSignOut: () => mockSignOut,
}));

vi.mock('@/services/electron/remoteServer', () => ({
  remoteServerService: {
    cancelAuthorization: vi.fn(),
  },
}));

vi.mock('@/services/electron/system', () => ({
  electronSystemService: {
    hasLegacyLocalDb: vi.fn().mockResolvedValue(false),
    openExternalLink: vi.fn(),
    showContextMenu: vi.fn(),
  },
}));

vi.mock('@/store/electron', () => ({
  useElectronStore: <T,>(selector: (state: typeof mockElectronState) => T) =>
    selector(mockElectronState),
}));

vi.mock('@/utils/electron/autoOidc', () => ({
  setDesktopAutoOidcFirstOpenHandled: vi.fn(),
}));

vi.mock('../components/LobeMessage', () => ({
  default: ({ sentences }: { sentences: string[] }) => (
    <div>{sentences.filter(Boolean).join(' ')}</div>
  ),
}));

const renderLoginStep = async (props: { mode?: 'onboarding' | 'status' } = {}) => {
  const { default: LoginStep } = await import('./LoginStep');
  const onBack = vi.fn();
  const onNext = vi.fn();

  render(<LoginStep onBack={onBack} onNext={onNext} {...props} />);

  return { onBack, onNext };
};

beforeEach(() => {
  mockElectronState.clearRemoteServerSyncError.mockClear();
  mockElectronState.connectRemoteServer.mockClear();
  mockElectronState.dataSyncConfig = { active: true, storageMode: 'cloud' };
  mockElectronState.isConnectingServer = false;
  mockElectronState.refreshServerConfig.mockClear();
  mockElectronState.remoteServerSyncError = undefined;
  mockElectronState.useDataSyncConfig.mockClear();
  mockSignOut.mockClear();
  mockSignOut.mockResolvedValue(undefined);
});

afterEach(() => {
  cleanup();
});

describe('Desktop onboarding LoginStep', () => {
  it('renders a focused success state without an authorization banner', async () => {
    await renderLoginStep();

    expect(screen.queryByText('Authorization Successful')).not.toBeInTheDocument();
    expect(screen.getByText('User Info')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Next' })).toBeInTheDocument();
    expect(screen.queryByText('OR')).not.toBeInTheDocument();
    expect(screen.queryByText('Use self-hosted server')).not.toBeInTheDocument();
  });

  it('leaves the success state through the host in onboarding mode instead of resetting to the chooser', async () => {
    const { onBack } = await renderLoginStep();

    fireEvent.click(screen.getByRole('button', { name: 'Back' }));

    expect(onBack).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('button', { name: 'Sign in Cloud' })).not.toBeInTheDocument();
    expect(screen.getByText('User Info')).toBeInTheDocument();
  });

  it('renders a connection summary instead of the sign-in wizard in status mode', async () => {
    const { onNext } = await renderLoginStep({ mode: 'status' });

    expect(screen.getByText('Connected to LobeHub Cloud')).toBeInTheDocument();
    expect(screen.getByText('Everything is syncing across all your devices.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Back' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Next' })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    expect(onNext).toHaveBeenCalledTimes(1);
  });

  it('names the self-hosted server it is connected to in status mode', async () => {
    mockElectronState.dataSyncConfig = {
      active: true,
      remoteServerUrl: 'https://my-server.example.com',
      storageMode: 'selfHost',
    };

    await renderLoginStep({ mode: 'status' });

    expect(screen.getByText('Connected to your own server')).toBeInTheDocument();
    expect(screen.getByText('Syncing with https://my-server.example.com.')).toBeInTheDocument();
  });

  it('signs out through the shared flow in status mode rather than faking a logged-out screen', async () => {
    await renderLoginStep({ mode: 'status' });

    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }));

    expect(mockSignOut).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('button', { name: 'Sign in Cloud' })).not.toBeInTheDocument();
  });
});
