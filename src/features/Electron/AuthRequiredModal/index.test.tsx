import { act, fireEvent, render, renderHook, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import AuthRequiredModal, { useAuthRequiredModal } from './index';

interface ModalProps {
  content?: ReactNode;
  footer?: ReactNode;
  maskClosable?: boolean;
  onOpenChange?: (open: boolean) => void;
  open?: boolean;
  styles?: {
    close?: React.CSSProperties;
  };
  title?: ReactNode;
}

const createModalMock = vi.hoisted(() => vi.fn());
const modalInstance = vi.hoisted(() => ({
  close: vi.fn(),
  update: vi.fn(),
}));
const translations = vi.hoisted(() => ({ current: {} as Record<string, string> }));
const broadcastHandlers = vi.hoisted(
  () => new Map<string, (payload?: { reason?: string }) => void>(),
);
const electronStore = vi.hoisted(() => ({
  current: {
    clearRemoteServerSyncError: vi.fn(),
    connectRemoteServer: vi.fn(),
    dataSyncConfig: undefined as { remoteServerUrl?: string; storageMode?: string } | undefined,
    isConnectionDrawerOpen: false,
    isInitRemoteServerConfig: true,
    refreshServerConfig: vi.fn(),
  },
}));

vi.mock('@lobechat/electron-client-ipc', () => ({
  useWatchBroadcast: (event: string, handler: (payload?: { reason?: string }) => void) => {
    broadcastHandlers.set(event, handler);
  },
}));

vi.mock('@lobehub/ui', () => ({
  Button: ({
    children,
    disabled,
    onClick,
  }: {
    children?: ReactNode;
    disabled?: boolean;
    onClick?: () => void;
  }) => (
    <button disabled={disabled} type="button" onClick={onClick}>
      {children}
    </button>
  ),
  Flexbox: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  Icon: () => <span data-testid="modal-icon" />,
}));

vi.mock('@lobehub/ui/base-ui', () => ({
  Button: ({
    children,
    disabled,
    loading,
    onClick,
  }: {
    children?: ReactNode;
    disabled?: boolean;
    loading?: boolean;
    onClick?: () => void;
  }) => (
    <button disabled={disabled || loading} type="button" onClick={onClick}>
      {children}
    </button>
  ),
  createModal: (props: ModalProps) => {
    createModalMock(props);

    return modalInstance;
  },
  ModalFooter: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
}));

vi.mock('react-i18next', () => ({
  useTranslation: (namespace?: string) => ({
    t: (key: string) => translations.current[`${namespace}:${key}`] ?? key,
  }),
}));

vi.mock('@/store/electron', () => {
  const useElectronStore = Object.assign(
    <T,>(selector: (state: typeof electronStore.current) => T): T =>
      selector(electronStore.current),
    { getState: () => electronStore.current },
  );

  return { useElectronStore };
});

describe('useAuthRequiredModal', () => {
  beforeEach(() => {
    createModalMock.mockClear();
    modalInstance.close.mockClear();
    modalInstance.update.mockClear();
    broadcastHandlers.clear();
    electronStore.current.clearRemoteServerSyncError.mockClear();
    electronStore.current.connectRemoteServer.mockClear();
    electronStore.current.refreshServerConfig.mockClear();
    translations.current = {};
  });

  it('closes the modal when desktop authorization succeeds', () => {
    render(<AuthRequiredModal />);

    act(() => {
      broadcastHandlers.get('authorizationRequired')?.({ reason: 'refresh:invalid_grant' });
    });

    expect(createModalMock).toHaveBeenCalledOnce();

    act(() => {
      broadcastHandlers.get('authorizationSuccessful')?.();
    });

    expect(modalInstance.close).toHaveBeenCalledOnce();
    expect(electronStore.current.refreshServerConfig).toHaveBeenCalledOnce();
  });

  it('renders the title from auth translations after the namespace becomes available', () => {
    const { result } = renderHook(() => useAuthRequiredModal());

    act(() => {
      result.current.open();
    });

    const [modalProps] = createModalMock.mock.calls[0] as [ModalProps];
    translations.current['auth:authModal.title'] = 'Session Expired';

    render(<>{modalProps.title}</>);

    expect(screen.getByText('Session Expired')).toBeInTheDocument();
    expect(screen.queryByText('authModal.title')).not.toBeInTheDocument();
  });

  it('keeps the close button available while removing the Later action', () => {
    translations.current = {
      'auth:authModal.later': 'Later',
      'auth:authModal.signIn': 'Sign In Again',
      'auth:authModal.signingIn': 'Signing in...',
    };
    const { result } = renderHook(() => useAuthRequiredModal());

    act(() => {
      result.current.open();
    });

    const [modalProps] = createModalMock.mock.calls[0] as [ModalProps];

    expect(modalProps.maskClosable).toBe(false);
    expect(modalProps.styles?.close).toBeUndefined();

    render(
      <>
        {modalProps.content}
        {modalProps.footer}
      </>,
    );

    expect(screen.queryByText('Later')).not.toBeInTheDocument();
    fireEvent.click(screen.getByText('Sign In Again'));

    expect(electronStore.current.clearRemoteServerSyncError).toHaveBeenCalled();
    expect(electronStore.current.connectRemoteServer).toHaveBeenCalledWith({
      remoteServerUrl: undefined,
      storageMode: 'cloud',
    });

    act(() => {
      modalProps.onOpenChange?.(false);
    });

    act(() => {
      result.current.open();
    });

    expect(createModalMock).toHaveBeenCalledTimes(2);
  });
});
