// @vitest-environment happy-dom
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  addPasskey: vi.fn(),
  deletePasskey: vi.fn(),
  disableEmailPassword: false,
  enableMagicLink: false,
  hasPasswordAccount: false,
  linkedProviders: [] as { provider: string; providerAccountId: string }[],
  ssoProviders: [] as string[],
  isError: false,
  passkeys: [] as { createdAt?: string; id: string; name?: string }[],
  refetch: vi.fn(),
  renamePasskey: vi.fn(),
}));

vi.mock('./usePasskeys', () => ({
  usePasskeys: () => ({
    addPasskey: mocks.addPasskey,
    deletePasskey: mocks.deletePasskey,
    isError: mocks.isError,
    isLoading: false,
    passkeys: mocks.passkeys,
    refetch: mocks.refetch,
    renamePasskey: mocks.renamePasskey,
  }),
}));

vi.mock('@lobechat/const', () => ({ isDesktop: false }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));

vi.mock('@/store/user', () => ({ useUserStore: (fn: any) => fn({}) }));
vi.mock('@/store/user/selectors', () => ({
  authSelectors: {
    authProviders: () => mocks.linkedProviders,
    hasPasswordAccount: () => mocks.hasPasswordAccount,
    isLogin: () => true,
  },
}));
vi.mock('@/store/serverConfig', () => ({ useServerConfigStore: (fn: any) => fn({}) }));
vi.mock('@/store/serverConfig/selectors', () => ({
  serverConfigSelectors: {
    disableEmailPassword: () => mocks.disableEmailPassword,
    enableMagicLink: () => mocks.enableMagicLink,
    oAuthSSOProviders: () => mocks.ssoProviders,
  },
}));

const PasskeyList = (await import('./index')).default;

describe('PasskeyList', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.isError = false;
    mocks.enableMagicLink = false;
    mocks.disableEmailPassword = false;
    mocks.hasPasswordAccount = false;
    mocks.linkedProviders = [];
    mocks.ssoProviders = [];
    mocks.passkeys = [];
  });

  // These actions were once click-only `Text`/`Flexbox` nodes, which keyboard
  // users could neither reach nor activate.
  it('lets a keyboard user reach and activate the add action', async () => {
    const user = userEvent.setup();
    render(<PasskeyList />);

    await user.tab();

    expect(screen.getByRole('button', { name: 'profile.passkey.add' })).toHaveFocus();

    await user.keyboard('{Enter}');
    await waitFor(() => expect(mocks.addPasskey).toHaveBeenCalled());
  });

  it('lets a keyboard user retry a failed load', async () => {
    mocks.isError = true;
    const user = userEvent.setup();
    render(<PasskeyList />);

    const retry = screen.getByRole('button', { name: 'profile.passkey.retry' });
    await user.tab();
    expect(retry).toHaveFocus();

    await user.keyboard('{Enter}');
    await waitFor(() => expect(mocks.refetch).toHaveBeenCalled());
  });

  it('shows the failure state instead of claiming there are no passkeys', () => {
    mocks.isError = true;
    render(<PasskeyList />);

    expect(screen.getByText('profile.passkey.loadError')).toBeInTheDocument();
    expect(screen.queryByText('profile.passkey.empty')).not.toBeInTheDocument();
  });

  // Magic link is a usable way back in, so a lone passkey must stay removable.
  it('allows removing the only passkey when magic link is enabled', () => {
    mocks.enableMagicLink = true;
    mocks.passkeys = [{ id: 'a', name: 'Touch ID' }];
    render(<PasskeyList />);

    expect(screen.queryByText('profile.passkey.delete.forbidden')).not.toBeInTheDocument();
  });

  it('blocks removing the only passkey when no alternative remains', () => {
    mocks.passkeys = [{ id: 'a', name: 'Touch ID' }];
    render(<PasskeyList />);

    expect(screen.getAllByText('profile.passkey.delete.forbidden').length).toBeGreaterThan(0);
  });

  // A credential row survives AUTH_DISABLE_EMAIL_PASSWORD=1, but the sign-in
  // form is gone — counting it would strand the user outside their account.
  it('does not count a password that can no longer be used', () => {
    mocks.hasPasswordAccount = true;
    mocks.disableEmailPassword = true;
    mocks.passkeys = [{ id: 'a', name: 'Touch ID' }];
    render(<PasskeyList />);

    expect(screen.getAllByText('profile.passkey.delete.forbidden').length).toBeGreaterThan(0);
  });

  it('does not count a provider the server no longer offers', () => {
    mocks.linkedProviders = [{ provider: 'github', providerAccountId: 'github-user' }];
    mocks.ssoProviders = [];
    mocks.passkeys = [{ id: 'a', name: 'Touch ID' }];
    render(<PasskeyList />);

    expect(screen.getAllByText('profile.passkey.delete.forbidden').length).toBeGreaterThan(0);
  });

  it('counts a provider that is still configured', () => {
    mocks.linkedProviders = [{ provider: 'github', providerAccountId: 'github-user' }];
    mocks.ssoProviders = ['github'];
    mocks.passkeys = [{ id: 'a', name: 'Touch ID' }];
    render(<PasskeyList />);

    expect(screen.queryByText('profile.passkey.delete.forbidden')).not.toBeInTheDocument();
  });

  // The only magic-link call site sits behind the email form, which is hidden
  // when email/password is disabled — an enabled-but-unreachable fallback.
  it('does not count magic link when the email form is hidden', () => {
    mocks.enableMagicLink = true;
    mocks.disableEmailPassword = true;
    mocks.passkeys = [{ id: 'a', name: 'Touch ID' }];
    render(<PasskeyList />);

    expect(screen.getAllByText('profile.passkey.delete.forbidden').length).toBeGreaterThan(0);
  });

  // The editable field shows "Unnamed passkey" when the authenticator gave no
  // name; submitting without typing must not save that placeholder as the name.
  it('does not persist the unnamed placeholder on a no-op rename', async () => {
    mocks.passkeys = [{ id: 'a' }];
    const user = userEvent.setup();
    render(<PasskeyList />);

    await user.click(screen.getByRole('button', { name: 'profile.passkey.rename' }));
    const input = screen.getByRole('textbox');
    expect(input).toHaveValue('profile.passkey.unnamed');

    await user.keyboard('{Enter}');

    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    expect(mocks.renamePasskey).not.toHaveBeenCalled();
  });
});
