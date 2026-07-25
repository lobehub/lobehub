'use client';

import { ActionIcon, DropdownMenu, Flexbox, Icon, Input, Text } from '@lobehub/ui';
import { Button, createModal, type ModalInstance, Switch } from '@lobehub/ui/base-ui';
import { Radio } from 'antd';
import { createStaticStyles, cssVar } from 'antd-style';
import { t as i18nT } from 'i18next';
import {
  CheckIcon,
  MoreHorizontalIcon,
  PencilIcon,
  Trash2Icon,
  XIcon,
  ZapIcon,
} from 'lucide-react';
import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { agentQuotaService } from '@/services/agentQuota';

const styles = createStaticStyles(({ css }) => ({
  footer: css`
    margin-block-start: 4px;
    padding-block-start: 10px;
    border-block-start: 1px solid ${cssVar.colorBorderSecondary};
  `,
  hint: css`
    font-size: 12px;
    color: ${cssVar.colorTextTertiary};
  `,
  routing: css`
    margin-inline-start: 26px;
    padding-block: 6px;
    padding-inline: 10px;
    border-radius: ${cssVar.borderRadius};

    font-size: 12px;
    color: ${cssVar.colorTextSecondary};

    background: ${cssVar.colorFillQuaternary};
  `,
  row: css`
    padding-block: 6px;
    padding-inline: 4px;
    border-radius: ${cssVar.borderRadius};

    &:hover {
      background: ${cssVar.colorFillQuaternary};
    }

    &[data-off='true'] {
      opacity: 0.5;
    }
  `,
}));

type Account = Awaited<ReturnType<typeof agentQuotaService.listAccounts>>[number];
type Binding = Awaited<ReturnType<typeof agentQuotaService.listBindings>>[number];
type QuotaWindow = Awaited<ReturnType<typeof agentQuotaService.getWindows>>[number];

const AUTO = 'auto';

const clampPercent = (n: number) => Math.min(100, Math.max(0, Math.round(n)));

const weeklyLeftOf = (windows: QuotaWindow[]): number | undefined => {
  const wk = windows.find((w) => w.limitType === 'weekly_all');
  if (!wk) return undefined;
  const used = wk.lastUtilization ?? wk.peakUtilization;
  return used == null ? undefined : clampPercent(100 - used);
};

const accountName = (a: Account) => a.label || a.email || a.externalAccountId;

const QuotaAccountManager = memo<{ agentId: string }>(({ agentId }) => {
  const { t } = useTranslation('chat');
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [bindings, setBindings] = useState<Binding[]>([]);
  const [weeklyById, setWeeklyById] = useState<Record<string, number | undefined>>({});
  const [busy, setBusy] = useState(false);
  // Staged account selection — applied only when the user confirms.
  const [pending, setPending] = useState<string | null>(null);
  // Inline rename state (no nested modal).
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editLabel, setEditLabel] = useState('');

  const load = useCallback(async () => {
    const [accs, binds] = await Promise.all([
      agentQuotaService.listAccounts(),
      agentQuotaService.listBindings(agentId),
    ]);
    setAccounts(accs);
    setBindings(binds);

    const entries = await Promise.all(
      accs.map(async (a) => {
        const w = await agentQuotaService.getWindows(a.id).catch(() => [] as QuotaWindow[]);
        return [a.id, weeklyLeftOf(w)] as const;
      }),
    );
    setWeeklyById(Object.fromEntries(entries));
  }, [agentId]);

  useEffect(() => {
    void load().catch(() => {});
  }, [load]);

  const roleOf = useCallback(
    (accountId: string) => bindings.find((b) => b.accountId === accountId)?.role,
    [bindings],
  );
  const bindingOf = useCallback(
    (accountId: string) => bindings.find((b) => b.accountId === accountId),
    [bindings],
  );
  const inRotation = useCallback(
    (accountId: string) => {
      const r = roleOf(accountId);
      return r === 'pinned' || r === 'pool';
    },
    [roleOf],
  );

  const pinnedId = bindings.find((b) => b.role === 'pinned')?.accountId;
  const current = pinnedId ?? AUTO;
  const selected = pending ?? current;
  const dirty = pending !== null && pending !== current;

  const run = useCallback(
    async (fn: () => Promise<unknown>) => {
      setBusy(true);
      try {
        await fn();
        await load();
      } finally {
        setBusy(false);
      }
    },
    [load],
  );

  // Preview which account Auto would route to (most weekly headroom in the pool).
  const routeId = useMemo(() => {
    if (selected !== AUTO) return null;
    const pool = accounts.filter((a) => inRotation(a.id));
    if (pool.length === 0) return null;
    return [...pool].sort((a, b) => (weeklyById[b.id] ?? 100) - (weeklyById[a.id] ?? 100))[0].id;
  }, [selected, accounts, inRotation, weeklyById]);
  const routeAccount = accounts.find((a) => a.id === routeId);

  const applySelection = useCallback(
    () =>
      run(async () => {
        const value = pending;
        if (value === null) return;
        if (value === AUTO) {
          if (pinnedId) await agentQuotaService.bindAccount(agentId, pinnedId, 'pool');
        } else {
          if (!bindings.some((b) => b.accountId === value)) {
            await agentQuotaService.bindAccount(agentId, value, 'pool');
          }
          await agentQuotaService.switchAccount(agentId, value);
        }
      }).then(() => setPending(null)),
    [agentId, bindings, pending, pinnedId, run],
  );

  const setRotation = useCallback(
    (accountId: string, next: boolean) =>
      run(() => agentQuotaService.bindAccount(agentId, accountId, next ? 'pool' : 'disabled')),
    [agentId, run],
  );

  const remove = useCallback(
    (accountId: string) => {
      const b = bindingOf(accountId);
      if (!b) return;
      // Removing the account currently staged for switch cancels the stage.
      if (pending === accountId) setPending(null);
      return run(() => agentQuotaService.unbindAccount(b.id));
    },
    [bindingOf, pending, run],
  );

  const startEdit = useCallback((a: Account) => {
    setEditingId(a.id);
    setEditLabel(a.label ?? '');
  }, []);
  const saveEdit = useCallback(
    (accountId: string) =>
      run(() =>
        agentQuotaService.updateAccount(accountId, { label: editLabel.trim() || undefined }),
      ).then(() => setEditingId(null)),
    [editLabel, run],
  );

  return (
    <Flexbox gap={2}>
      <Radio.Group
        style={{ width: '100%' }}
        value={selected}
        onChange={(e) => setPending(e.target.value as string)}
      >
        {/* Auto balance is the first option in the pool, not a separate toggle */}
        <Flexbox className={styles.row} gap={4}>
          <Radio disabled={busy} value={AUTO}>
            <Text style={{ fontSize: 13 }}>{t('heteroAgent.claudeQuota.manage.modeAuto')}</Text>
          </Radio>
          {selected === AUTO && (
            <Flexbox horizontal align={'center'} className={styles.routing} gap={6}>
              <Icon icon={ZapIcon} size={14} />
              {routeAccount
                ? t('heteroAgent.claudeQuota.manage.autoRoutingTo', {
                    account: accountName(routeAccount),
                  })
                : t('heteroAgent.claudeQuota.manage.autoNoAccount')}
            </Flexbox>
          )}
        </Flexbox>

        {accounts.map((a) => {
          const rotate = inRotation(a.id);
          const weekly = weeklyById[a.id];
          const isEditing = editingId === a.id;
          const menuItems = [
            {
              icon: <Icon icon={PencilIcon} />,
              key: 'edit',
              label: t('heteroAgent.claudeQuota.manage.edit'),
              onClick: () => startEdit(a),
            },
            { type: 'divider' as const },
            {
              danger: true,
              disabled: !bindingOf(a.id),
              icon: <Icon icon={Trash2Icon} />,
              key: 'remove',
              label: t('heteroAgent.claudeQuota.manage.remove'),
              onClick: () => void remove(a.id),
            },
          ];

          return (
            <Flexbox
              horizontal
              align={'center'}
              className={styles.row}
              data-off={!rotate}
              gap={8}
              key={a.id}
            >
              <Radio disabled={busy || !rotate || isEditing} value={a.id} />
              {isEditing ? (
                <>
                  <Input
                    autoFocus
                    placeholder={a.email || t('heteroAgent.claudeQuota.manage.labelPlaceholder')}
                    size={'small'}
                    style={{ flex: 1 }}
                    value={editLabel}
                    onChange={(e) => setEditLabel(e.target.value)}
                    onPressEnter={() => void saveEdit(a.id)}
                  />
                  <ActionIcon
                    disabled={busy}
                    icon={CheckIcon}
                    size={'small'}
                    onClick={() => void saveEdit(a.id)}
                  />
                  <ActionIcon icon={XIcon} size={'small'} onClick={() => setEditingId(null)} />
                </>
              ) : (
                <>
                  <Flexbox flex={1} gap={0} style={{ minWidth: 0 }}>
                    <Flexbox horizontal align={'center'} gap={6} style={{ minWidth: 0 }}>
                      <Text ellipsis style={{ fontSize: 13 }}>
                        {accountName(a)}
                      </Text>
                      {a.planTier && (
                        <Text style={{ flex: 'none', fontSize: 12 }} type={'secondary'}>
                          {a.planTier}
                        </Text>
                      )}
                    </Flexbox>
                    {/* Only a real quota reading gets a subline; a disabled row is
                        conveyed by the dimmed state, and no-data shows nothing. */}
                    {rotate && weekly != null && (
                      <Text style={{ fontSize: 12 }} type={'secondary'}>
                        {weekly === 0
                          ? t('heteroAgent.claudeQuota.manage.exhausted')
                          : t('heteroAgent.claudeQuota.manage.weeklyLeft', { percent: weekly })}
                      </Text>
                    )}
                  </Flexbox>
                  <Switch
                    checked={rotate}
                    disabled={busy}
                    size={'small'}
                    onChange={(v) => void setRotation(a.id, v)}
                  />
                  <DropdownMenu items={menuItems} placement={'bottomRight'}>
                    <ActionIcon
                      icon={MoreHorizontalIcon}
                      size={'small'}
                      title={t('heteroAgent.claudeQuota.manage.more')}
                    />
                  </DropdownMenu>
                </>
              )}
            </Flexbox>
          );
        })}
      </Radio.Group>

      {accounts.length === 0 && (
        <Text className={styles.hint}>{t('heteroAgent.claudeQuota.manage.empty')}</Text>
      )}

      {dirty ? (
        <Flexbox horizontal className={styles.footer} gap={8} justify={'flex-end'}>
          <Button disabled={busy} onClick={() => setPending(null)}>
            {i18nT('cancel', { ns: 'common' })}
          </Button>
          <Button loading={busy} type={'primary'} onClick={() => void applySelection()}>
            {t('heteroAgent.claudeQuota.manage.confirmSwitch')}
          </Button>
        </Flexbox>
      ) : (
        <Text className={styles.hint} style={{ marginBlockStart: 4 }}>
          {t('heteroAgent.claudeQuota.manage.addHint')}
        </Text>
      )}
    </Flexbox>
  );
});

QuotaAccountManager.displayName = 'QuotaAccountManager';

/** Calling this opens the modal — `createModal` mounts immediately. */
export const openQuotaAccountManagerModal = (agentId: string): ModalInstance =>
  createModal({
    content: <QuotaAccountManager agentId={agentId} />,
    footer: null,
    title: i18nT('heteroAgent.claudeQuota.manage.title', { ns: 'chat' }),
    width: 460,
  });

export default QuotaAccountManager;
