'use client';

import { currentUtilization, isWeeklyAllLimit } from '@lobechat/heterogeneous-agents/quota';
import { DropdownMenu, Flexbox, Icon, Input } from '@lobehub/ui';
import {
  ActionIcon,
  Button,
  createModal,
  type ModalInstance,
  RadioGroup,
  Switch,
  Text,
} from '@lobehub/ui/base-ui';
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
import { memo, type MouseEvent, useCallback, useEffect, useMemo, useState } from 'react';
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
  interactive: css`
    display: contents;
  `,
  radioGroup: css`
    width: 100%;

    > label {
      width: 100%;
    }

    > label > span:last-child {
      flex: 1;
      min-width: 0;
    }
  `,
  routing: css`
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
type QuotaReading = Awaited<ReturnType<typeof agentQuotaService.getLatestReadings>>[number];

const AUTO = 'auto';

const clampPercent = (n: number) => Math.min(100, Math.max(0, Math.round(n)));

/**
 * Weekly headroom for the account row. A reading whose window already rolled
 * over describes spend that has since refilled, so it counts as free rather
 * than as the last utilization it happened to record.
 */
const weeklyLeftOf = (readings: QuotaReading[], now = Date.now()): number | undefined => {
  const weekly = readings.find((r) => isWeeklyAllLimit(r));
  return weekly ? clampPercent(100 - currentUtilization(weekly, now)) : undefined;
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
        const readings = await agentQuotaService
          .getLatestReadings(a.id)
          .catch(() => [] as QuotaReading[]);
        return [a.id, weeklyLeftOf(readings)] as const;
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

  const preventRadioSelection = useCallback((event: MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
  }, []);

  return (
    <Flexbox gap={2}>
      <RadioGroup
        className={styles.radioGroup}
        gap={2}
        horizontal={false}
        value={selected}
        options={[
          {
            disabled: busy,
            label: (
              <Flexbox className={styles.row} gap={4}>
                <Text style={{ fontSize: 13 }}>{t('heteroAgent.claudeQuota.manage.modeAuto')}</Text>
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
            ),
            value: AUTO,
          },
          ...accounts.map((a) => {
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

            return {
              disabled: busy || !rotate || isEditing,
              label: (
                <Flexbox
                  horizontal
                  align={'center'}
                  className={styles.row}
                  data-off={!rotate}
                  gap={8}
                >
                  {isEditing ? (
                    <>
                      <Input
                        autoFocus
                        size={'small'}
                        style={{ flex: 1 }}
                        value={editLabel}
                        placeholder={
                          a.email || t('heteroAgent.claudeQuota.manage.labelPlaceholder')
                        }
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
                              : t('heteroAgent.claudeQuota.manage.weeklyLeft', {
                                  percent: weekly,
                                })}
                          </Text>
                        )}
                      </Flexbox>
                      <span className={styles.interactive} onClick={preventRadioSelection}>
                        <Switch
                          checked={rotate}
                          disabled={busy}
                          size={'small'}
                          onChange={(v) => void setRotation(a.id, v)}
                        />
                      </span>
                      <span className={styles.interactive} onClick={preventRadioSelection}>
                        <DropdownMenu items={menuItems} placement={'bottomRight'}>
                          <ActionIcon
                            icon={MoreHorizontalIcon}
                            size={'small'}
                            title={t('heteroAgent.claudeQuota.manage.more')}
                          />
                        </DropdownMenu>
                      </span>
                    </>
                  )}
                </Flexbox>
              ),
              value: a.id,
            };
          }),
        ]}
        onChange={setPending}
      />

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
