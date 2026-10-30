'use client';

import { ClaudeCode, Codex, Kimi } from '@lobehub/icons';
import {
  ActionIcon,
  DropdownMenu,
  Flexbox,
  Icon,
  Input,
  Switch,
  Text,
  toast,
  Tooltip,
} from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import dayjs from 'dayjs';
import { CheckIcon, MoreHorizontalIcon, PanelRightOpenIcon, PencilIcon, XIcon } from 'lucide-react';
import { type CSSProperties, type ReactNode, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { formatPercent, usageLevel } from '@/features/DeviceManager/DeviceHealth/format';
import { usageTextColor } from '@/features/DeviceManager/DeviceHealth/shared';
import { UsageBar } from '@/features/DeviceManager/DeviceHealth/UsageMeter';
import { type QuotaAccount, useAgentQuotaStore } from '@/store/agentQuota';

import { type AccountStatus, deriveAccountView, type SubscriptionProvider } from './accountView';

/** Column widths shared by {@link AccountRow} and {@link AccountListHeader}. */
export const COLUMN_WIDTH = {
  account: 140,
  actions: 28,
  plan: 72,
  quota: 190,
  // Wider than the switch so it sits centered with clear space after the quota bars.
  rotation: 88,
  status: 120,
} as const;

/**
 * Narrowest the list may get before it scrolls sideways instead: every
 * column at its minimum, the 16px gaps between the seven columns and the row
 * padding. Below this the rotation switch and menu would clip.
 */
export const LIST_MIN_WIDTH =
  COLUMN_WIDTH.plan +
  COLUMN_WIDTH.quota +
  COLUMN_WIDTH.status +
  COLUMN_WIDTH.rotation +
  COLUMN_WIDTH.actions +
  COLUMN_WIDTH.account +
  16 * 6 +
  12 * 2;

const styles = stylex.create({
  presence: (color: string) => ({
    flex: 'none',
    width: '8px',
    height: '8px',
    borderRadius: '50%',
    backgroundColor: color,
  }),
  row: {
    display: 'flex',
    alignItems: 'center',
    gap: '16px',
    paddingBlock: '12px',
    paddingInline: '12px',
    borderRadius: cssVar.borderRadius,
    cursor: 'pointer',
    backgroundColor: { 'default': 'transparent', ':hover': cssVar.colorFillTertiary },
    outline: { 'default': 'none', ':focus-visible': `2px solid ${cssVar.colorPrimary}` },
  },
  // The account whose panel is open.
  rowActive: { backgroundColor: cssVar.colorFillSecondary },
});

const PROVIDER_META: Record<
  SubscriptionProvider,
  { icon: (size: number) => ReactNode; name: string }
> = {
  'claude-code': { icon: (size) => <ClaudeCode.Avatar size={size} />, name: 'Claude Code' },
  'codex': { icon: (size) => <Codex.Avatar size={size} />, name: 'Codex' },
  'kimi-code': { icon: (size) => <Kimi.Avatar size={size} />, name: 'Kimi Code' },
};

export const PROVIDER_NAME = Object.fromEntries(
  Object.entries(PROVIDER_META).map(([key, meta]) => [key, meta.name]),
) as Record<SubscriptionProvider, string>;

const STATUS_COLOR: Record<AccountStatus, string> = {
  available: cssVar.colorSuccess,
  disabled: cssVar.colorTextQuaternary,
  exhausted: cssVar.colorError,
  noData: cssVar.colorTextQuaternary,
};

export const accountDisplayName = (account: QuotaAccount) =>
  account.label || account.email || account.externalAccountId || account.id;

/** One window's usage: its label, the device page's segmented bar and the percentage, `—` before any reading. */
const WindowMeter = ({ label, value }: { label: string; value?: number }) => {
  const level = usageLevel(value);
  return (
    <Flexbox horizontal align={'center'} gap={8}>
      <Text
        fontSize={12}
        style={{ flex: 'none', whiteSpace: 'nowrap', width: 40 }}
        type={'secondary'}
      >
        {label}
      </Text>
      <Flexbox flex={1} style={{ minWidth: 0 }}>
        <UsageBar height={8} value={value} />
      </Flexbox>
      <Text
        fontSize={12}
        type={level ? undefined : 'secondary'}
        style={{
          color: usageTextColor(level),
          flex: 'none',
          textAlign: 'end',
          whiteSpace: 'nowrap',
          width: 36,
        }}
      >
        {formatPercent(value)}
      </Text>
    </Flexbox>
  );
};

/** Column labels, aligned with {@link AccountRow} through {@link COLUMN_WIDTH}. */
export const AccountListHeader = () => {
  const { t } = useTranslation('setting');
  // Account and status share the spare width (2:1); the rest keep fixed widths.
  const label = (text: string, style: CSSProperties) => (
    <Text ellipsis fontSize={12} style={style} type={'secondary'}>
      {text}
    </Text>
  );

  return (
    <Flexbox horizontal align={'center'} gap={16} paddingInline={12} style={{ paddingBlock: 4 }}>
      {label(t('subscriptionAccounts.columns.account'), {
        flex: 2,
        minWidth: COLUMN_WIDTH.account,
      })}
      {label(t('subscriptionAccounts.columns.plan'), { flex: 'none', width: COLUMN_WIDTH.plan })}
      {label(t('subscriptionAccounts.columns.status'), { flex: 1, minWidth: COLUMN_WIDTH.status })}
      {label(t('subscriptionAccounts.columns.quota'), { flex: 'none', width: COLUMN_WIDTH.quota })}
      {label(t('subscriptionAccounts.columns.rotation'), {
        flex: 'none',
        textAlign: 'center',
        width: COLUMN_WIDTH.rotation,
      })}
      <span style={{ flex: 'none', width: COLUMN_WIDTH.actions }} />
    </Flexbox>
  );
};

interface AccountRowProps {
  account: QuotaAccount & { provider: SubscriptionProvider };
  /** This account's side panel is open. */
  active?: boolean;
  /** Open this account's side panel. */
  onOpen: () => void;
}

const AccountRow = ({ account, active, onOpen }: AccountRowProps) => {
  const { t } = useTranslation('setting');
  const { t: tCommon } = useTranslation('common');
  const [useFetchQuotaReadings, renameQuotaAccount, setQuotaAccountEnabled] = useAgentQuotaStore(
    (s) => [s.useFetchQuotaReadings, s.renameQuotaAccount, s.setQuotaAccountEnabled],
  );
  useFetchQuotaReadings(account.id);
  const readings = useAgentQuotaStore((s) => s.quotaReadingsMap[account.id]);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');

  const view = deriveAccountView(account, readings, Date.now());
  const meta = PROVIDER_META[account.provider];
  const name = accountDisplayName(account);
  // With a label set, the email moves to the subtitle so the account stays identifiable.
  const subtitle = [meta.name, account.label ? account.email : undefined]
    .filter(Boolean)
    .join(' · ');

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    try {
      await fn();
      return true;
    } catch {
      toast.error(t('subscriptionAccounts.updateFailed'));
      return false;
    } finally {
      setBusy(false);
    }
  };

  const startEdit = () => {
    setDraft(account.label ?? '');
    setEditing(true);
  };
  const saveEdit = async () => {
    if (await run(() => renameQuotaAccount(account.id, draft.trim() || undefined)))
      setEditing(false);
  };

  const statusText = (() => {
    switch (view.status) {
      case 'disabled': {
        return t('subscriptionAccounts.status.disabled');
      }
      case 'exhausted': {
        return view.recoversAt
          ? t('subscriptionAccounts.status.exhausted', { time: dayjs(view.recoversAt).fromNow() })
          : t('subscriptionAccounts.status.exhaustedNoReset');
      }
      case 'noData': {
        return t('subscriptionAccounts.status.noData');
      }
      default: {
        return t('subscriptionAccounts.status.available', {
          time: dayjs(view.lastSyncedAt).fromNow(),
        });
      }
    }
  })();

  // Controls inside the row keep their clicks from opening the side panel.
  const stop = {
    onClick: (e: { stopPropagation: () => void }) => e.stopPropagation(),
    onKeyDown: (e: { stopPropagation: () => void }) => e.stopPropagation(),
  };

  return (
    <div
      {...stylex.props(styles.row, active && styles.rowActive)}
      aria-current={active || undefined}
      role={'button'}
      tabIndex={0}
      onClick={editing ? undefined : onOpen}
      onKeyDown={(e) => {
        if (e.key === 'Enter' && e.target === e.currentTarget) {
          e.preventDefault();
          onOpen();
        }
      }}
    >
      <Flexbox
        horizontal
        align={'center'}
        gap={12}
        // Out of rotation reads as dimmed, not hidden: the admin still sees what it holds.
        style={{
          flex: 2,
          minWidth: COLUMN_WIDTH.account,
          opacity: view.status === 'disabled' ? 0.55 : undefined,
        }}
      >
        <span style={{ display: 'flex', flex: 'none' }}>{meta.icon(28)}</span>
        <Flexbox gap={2} style={{ minWidth: 0 }}>
          {editing ? (
            <Flexbox horizontal align={'center'} gap={4} {...stop}>
              <Input
                autoFocus
                placeholder={account.email || t('subscriptionAccounts.renamePlaceholder')}
                size={'small'}
                style={{ flex: 1 }}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onPressEnter={() => void saveEdit()}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') setEditing(false);
                }}
              />
              <ActionIcon
                disabled={busy}
                icon={CheckIcon}
                size={'small'}
                title={tCommon('save')}
                onClick={() => void saveEdit()}
              />
              <ActionIcon
                icon={XIcon}
                size={'small'}
                title={tCommon('cancel')}
                onClick={() => setEditing(false)}
              />
            </Flexbox>
          ) : (
            <Text ellipsis title={name} weight={500}>
              {name}
            </Text>
          )}
          <Text ellipsis fontSize={12} type={'secondary'}>
            {subtitle}
          </Text>
        </Flexbox>
      </Flexbox>

      <Text
        ellipsis
        fontSize={13}
        style={{ flex: 'none', width: COLUMN_WIDTH.plan }}
        type={account.planTier ? undefined : 'secondary'}
      >
        {account.planTier || '—'}
      </Text>

      <Flexbox
        horizontal
        align={'center'}
        gap={8}
        style={{ flex: 1, minWidth: COLUMN_WIDTH.status }}
      >
        <span aria-hidden {...stylex.props(styles.presence(STATUS_COLOR[view.status]))} />
        <Text ellipsis fontSize={12} title={statusText} type={'secondary'}>
          {statusText}
        </Text>
      </Flexbox>

      {/* Both windows stacked in one column, so the pair reads as one quota. */}
      <Flexbox gap={6} style={{ flex: 'none', width: COLUMN_WIDTH.quota }}>
        <WindowMeter
          label={t('subscriptionAccounts.meter.session')}
          value={view.session?.usedPercent}
        />
        <WindowMeter
          label={t('subscriptionAccounts.meter.weekly')}
          value={view.weekly?.usedPercent}
        />
      </Flexbox>

      <Flexbox
        horizontal
        justify={'center'}
        style={{ flex: 'none', width: COLUMN_WIDTH.rotation }}
        {...stop}
      >
        <Tooltip title={t('subscriptionAccounts.rotationTooltip')}>
          <Switch
            aria-label={t('subscriptionAccounts.rotationTooltip')}
            checked={account.enabled !== false}
            disabled={busy}
            size={'small'}
            onChange={(checked) => void run(() => setQuotaAccountEnabled(account.id, checked))}
          />
        </Tooltip>
      </Flexbox>

      <Flexbox horizontal style={{ flex: 'none', width: COLUMN_WIDTH.actions }} {...stop}>
        <DropdownMenu
          placement={'bottomRight'}
          items={[
            {
              icon: <Icon icon={PanelRightOpenIcon} />,
              key: 'details',
              label: t('subscriptionAccounts.actions.viewDetails'),
              onClick: onOpen,
            },
            {
              icon: <Icon icon={PencilIcon} />,
              key: 'rename',
              label: t('subscriptionAccounts.actions.rename'),
              onClick: startEdit,
            },
          ]}
        >
          <ActionIcon icon={MoreHorizontalIcon} size={'small'} title={tCommon('more')} />
        </DropdownMenu>
      </Flexbox>
    </div>
  );
};

export default AccountRow;
