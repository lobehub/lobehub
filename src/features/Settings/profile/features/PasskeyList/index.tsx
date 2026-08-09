import { isDesktop } from '@lobechat/const';
import { ActionIcon, EditableText, Flexbox, Text, Tooltip } from '@lobehub/ui';
import { confirmModal } from '@lobehub/ui/base-ui';
import { KeyRound, PencilLine, Plus, Trash2 } from 'lucide-react';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';

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
  const { t } = useTranslation('auth');

  const { passkeys, isLoading, addPasskey, deletePasskey, renamePasskey } = usePasskeys();
  const [pending, setPending] = useState(false);
  // Authenticators frequently register without a label, which leaves the list
  // showing several indistinguishable entries until the user can name them.
  const [editingId, setEditingId] = useState<string | null>(null);

  // Never let users lock themselves out: a passkey may only be removed while
  // some other way to sign in remains (password, SSO, or another passkey).
  const allowDelete = passkeys.length > 1 || hasPasswordAccount || providers.length > 0;
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

  if (isLoading) {
    return (
      <Text fontSize={11} type="secondary">
        {t('profile.passkey.loading')}
      </Text>
    );
  }

  return (
    <Flexbox gap={8}>
      {passkeys.map((item) => (
        <Flexbox horizontal align={'center'} gap={8} justify={'space-between'} key={item.id}>
          <Flexbox horizontal align={'center'} gap={6} style={{ fontSize: 12 }}>
            <KeyRound size={16} />
            <EditableText
              // Let the name take the slack so the date is not squeezed onto a
              // second line when it grows.
              editing={editingId === item.id}
              showEditIcon={false}
              style={{ flex: 1, height: 24, minWidth: 0 }}
              value={item.name || t('profile.passkey.unnamed')}
              onEditingChange={(next) => setEditingId(next ? item.id : null)}
              onChangeEnd={async (input) => {
                const name = input.trim();
                setEditingId(null);
                if (name && name !== item.name) await renamePasskey(item.id, name);
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
              <Tooltip title={t('profile.passkey.rename')}>
                <ActionIcon
                  icon={PencilLine}
                  size={'small'}
                  onClick={() => setEditingId(item.id)}
                />
              </Tooltip>
              <Tooltip title={!allowDelete ? t('profile.passkey.delete.forbidden') : undefined}>
                <span>
                  <ActionIcon
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
      ))}

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
        <Flexbox
          horizontal
          align={'center'}
          gap={6}
          style={{
            cursor: pending ? 'default' : 'pointer',
            fontSize: 12,
            opacity: pending ? 0.6 : 1,
          }}
          onClick={handleAdd}
        >
          <Plus size={14} />
          <span>{pending ? t('profile.passkey.adding') : t('profile.passkey.add')}</span>
        </Flexbox>
      )}
    </Flexbox>
  );
});

export default PasskeyList;
