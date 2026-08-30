import { isDesktop } from '@lobechat/const';
import { ActionIcon, EditableText, Flexbox, Text, Tooltip } from '@lobehub/ui';
import { Button, confirmModal } from '@lobehub/ui/base-ui';
import { KeyRound, PencilLine, Plus, Trash2 } from 'lucide-react';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useServerConfigStore } from '@/store/serverConfig';
import { serverConfigSelectors } from '@/store/serverConfig/selectors';
import { useUserStore } from '@/store/user';
import { authSelectors } from '@/store/user/selectors';

import { usePasskeys } from './usePasskeys';

/**
 * Manage WebAuthn passkeys for the current account.
 *
 * The passkey plugin is always enabled on the server (see
 * `src/libs/better-auth/define-config.ts`), so this list only depends on the
 * user being signed in. Passkeys are bound to the rpID derived from `APP_URL`,
 * which is why registration is only offered on web: the desktop shell runs on a
 * different origin and its credentials would not be usable in the browser.
 */
export const PasskeyList = memo(() => {
  const isLogin = useUserStore(authSelectors.isLogin);
  const hasPasswordAccount = useUserStore(authSelectors.hasPasswordAccount);
  const providers = useUserStore(authSelectors.authProviders);
  const enableMagicLink = useServerConfigStore(serverConfigSelectors.enableMagicLink);
  const disableEmailPassword = useServerConfigStore(serverConfigSelectors.disableEmailPassword);
  const ssoProviders = useServerConfigStore(serverConfigSelectors.oAuthSSOProviders);
  const { t } = useTranslation('auth');

  const { passkeys, isError, isLoading, addPasskey, deletePasskey, renamePasskey, refetch } =
    usePasskeys();
  const [pending, setPending] = useState(false);
  // Authenticators frequently register without a label, which leaves the list
  // showing several indistinguishable entries until the user can name them.
  const [editingId, setEditingId] = useState<string | null>(null);

  // Never let users lock themselves out: the last passkey may only be removed
  // while another way to sign in is *currently usable*. A credential row still
  // exists after `AUTH_DISABLE_EMAIL_PASSWORD=1` hides the form, and an account
  // can stay linked to a provider the server no longer offers — counting either
  // would strand the user outside their account.
  const canUsePassword = hasPasswordAccount && !disableEmailPassword;
  // The only `signIn.magicLink` call site is behind the email form, which
  // `SignInEmailStep` hides when email/password is disabled — so an enabled
  // magic link is unreachable there and cannot justify deleting the last key.
  const canUseMagicLink = enableMagicLink && !disableEmailPassword;
  const canUseConfiguredSSO = providers.some(({ provider }) =>
    (ssoProviders ?? []).includes(provider),
  );

  const allowDelete =
    passkeys.length > 1 || canUsePassword || canUseConfiguredSSO || canUseMagicLink;
  const enableActions = !isDesktop && isLogin;

  const handleAdd = async () => {
    if (!enableActions || pending) return;

    setPending(true);
    try {
      await addPasskey();
    } finally {
      setPending(false);
    }
  };

  const handleDelete = (id: string, name?: string | null) => {
    // Keep the guard here as well: the control is disabled in the list, but
    // this also covers state races between render and click.
    if (!enableActions || !allowDelete) return;

    confirmModal({
      content: t('profile.passkey.delete.description', {
        name: name || t('profile.passkey.unnamed'),
      }),
      okButtonProps: {
        danger: true,
      },
      onOk: async () => {
        await deletePasskey(id);
      },
      title: t('profile.passkey.delete.title'),
    });
  };

  // A load failure must not be shown as an empty list — that would invite the
  // user to enrol another credential when they may already have several.
  if (isError) {
    return (
      <Flexbox horizontal align={'center'} gap={8}>
        <Text fontSize={11} type="danger">
          {t('profile.passkey.loadError')}
        </Text>
        <Button size={'small'} type={'text'} onClick={() => refetch()}>
          {t('profile.passkey.retry')}
        </Button>
      </Flexbox>
    );
  }

  if (isLoading) {
    return (
      <Text fontSize={11} type="secondary">
        {t('profile.passkey.loading')}
      </Text>
    );
  }

  return (
    <Flexbox gap={8}>
      {passkeys.map((item) => {
        // The fallback is what the field shows, so a blur without edits
        // must compare against it — otherwise the placeholder is saved
        // as the credential's real name.
        const displayName = item.name || t('profile.passkey.unnamed');

        return (
          <Flexbox horizontal align={'center'} gap={8} justify={'space-between'} key={item.id}>
            <Flexbox horizontal align={'center'} gap={6} style={{ fontSize: 12 }}>
              <KeyRound size={16} />
              <EditableText
                // Let the name take the slack so the date is not squeezed onto a
                // second line when it grows.
                editing={editingId === item.id}
                showEditIcon={false}
                style={{ flex: 1, height: 24, minWidth: 0 }}
                value={displayName}
                onEditingChange={(next) => setEditingId(next ? item.id : null)}
                onChangeEnd={async (input) => {
                  const name = input.trim();
                  setEditingId(null);
                  if (name && name !== displayName) await renamePasskey(item.id, name);
                }}
              />
              {item.createdAt && (
                <Text fontSize={11} style={{ flex: 'none', whiteSpace: 'nowrap' }} type="secondary">
                  · {new Date(item.createdAt).toLocaleDateString()}
                </Text>
              )}
            </Flexbox>
            {enableActions && (
              <Flexbox horizontal align={'center'} gap={2}>
                {/* `title` only renders a tooltip — icon-only controls still
                    need an explicit label, or assistive tech announces an
                    unnamed button. */}
                <ActionIcon
                  aria-label={t('profile.passkey.rename')}
                  icon={PencilLine}
                  size={'small'}
                  title={t('profile.passkey.rename')}
                  onClick={() => setEditingId(item.id)}
                />
                <Tooltip title={!allowDelete ? t('profile.passkey.delete.forbidden') : undefined}>
                  <span>
                    <ActionIcon
                      aria-label={t('profile.passkey.delete.title')}
                      disabled={!allowDelete}
                      icon={Trash2}
                      size={'small'}
                      onClick={() => handleDelete(item.id, item.name)}
                    />
                  </span>
                </Tooltip>
              </Flexbox>
            )}
          </Flexbox>
        );
      })}

      {passkeys.length === 0 && (
        <Text fontSize={11} type="secondary">
          {t('profile.passkey.empty')}
        </Text>
      )}

      {enableActions && !allowDelete && passkeys.length > 0 && (
        <Text fontSize={11} type="secondary">
          {t('profile.passkey.delete.forbidden')}
        </Text>
      )}

      {enableActions && (
        <Button
          disabled={pending}
          icon={<Plus size={14} />}
          size={'small'}
          style={{ alignSelf: 'flex-start' }}
          type={'text'}
          onClick={handleAdd}
        >
          {pending ? t('profile.passkey.adding') : t('profile.passkey.add')}
        </Button>
      )}
    </Flexbox>
  );
});

export default PasskeyList;
