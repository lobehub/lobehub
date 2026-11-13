'use client';

import { displayPlanTier } from '@lobechat/heterogeneous-agents/quota';
import {
  ActionIcon,
  DropdownMenu,
  type DropdownMenuProps,
  Flexbox,
  Icon,
  Input,
  Tag,
  Text,
} from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { t as i18nT } from 'i18next';
import { CheckIcon, MoreHorizontalIcon, XIcon, ZapIcon } from 'lucide-react';
import { type KeyboardEvent, memo, type ReactNode, type SyntheticEvent, useCallback } from 'react';
import { useTranslation } from 'react-i18next';

import { providerAvatar } from '@/features/SubscriptionAccounts/AccountRow';
import { isSubscriptionProvider } from '@/features/SubscriptionAccounts/accountView';
import { type QuotaAccount } from '@/store/agentQuota';

import { accountLines } from './accountLines';
import { type AccountLoad, type WindowLoad } from './accountLoad';

const styles = stylex.create({
  card: {
    display: 'flex',
    flexDirection: 'column',
    gap: '12px',
    minWidth: 0,
    paddingBlock: '12px',
    paddingInline: '14px',
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: cssVar.colorBorderSecondary,
    borderRadius: cssVar.borderRadiusLG,
    backgroundColor: cssVar.colorBgContainer,
    outline: { 'default': 'none', ':focus-visible': `2px solid ${cssVar.colorPrimary}` },
    transition: 'border-color 0.15s, background-color 0.15s',
  },
  clickable: {
    cursor: 'pointer',
    backgroundColor: { 'default': cssVar.colorBgContainer, ':hover': cssVar.colorFillQuaternary },
  },
  checked: {
    borderColor: cssVar.colorText,
    backgroundColor: { 'default': cssVar.colorFillTertiary, ':hover': cssVar.colorFillTertiary },
  },
  // Not pickable right now; the load stays readable, so only the cursor says so.
  locked: { cursor: 'default' },
  dot: {
    flex: 'none',
    boxSizing: 'border-box',
    width: '16px',
    height: '16px',
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: cssVar.colorBorder,
    borderRadius: '50%',
    backgroundColor: cssVar.colorBgContainer,
  },
  dotChecked: { borderWidth: '5px', borderColor: cssVar.colorText },
  loads: {
    display: 'grid',
    gridTemplateColumns: 'auto minmax(40px, 1fr) auto auto',
    columnGap: '8px',
    rowGap: '6px',
    alignItems: 'center',
  },
  label: {
    flex: 'none',
    minWidth: '40px',
    fontSize: '12px',
    color: cssVar.colorTextSecondary,
    whiteSpace: 'nowrap',
  },
  track: {
    overflow: 'hidden',
    flex: '1',
    minWidth: '40px',
    height: '6px',
    borderRadius: '999px',
    backgroundColor: cssVar.colorFillSecondary,
  },
  fill: { height: '100%', borderRadius: 'inherit', backgroundColor: cssVar.colorSuccess },
  fillLow: { backgroundColor: cssVar.colorWarning },
  value: {
    flex: 'none',
    minWidth: '36px',
    fontSize: '12px',
    whiteSpace: 'nowrap',
    fontVariantNumeric: 'tabular-nums',
    textAlign: 'end',
  },
  valueLow: { color: cssVar.colorWarningText },
  valueExhausted: { color: cssVar.colorTextTertiary },
  reset: {
    flex: 'none',
    minWidth: '44px',
    fontSize: '12px',
    color: cssVar.colorTextTertiary,
    whiteSpace: 'nowrap',
  },
  // Clicks on the card's own controls must not pick the card.
  controls: { display: 'contents' },
  // The rename field takes the name's place and shrinks with the card.
  rename: { display: 'flex', flex: '1', gap: '4px', alignItems: 'center', minWidth: 0 },
});

/** Renders "2d 3h" / "45m" with the same units as the chat-bar quota panel. */
const useFormatDuration = () => {
  const { t } = useTranslation('chat');

  return useCallback(
    (ms: number) => {
      const totalMinutes = Math.max(1, Math.floor(ms / 60_000));
      const days = Math.floor(totalMinutes / (24 * 60));
      const hours = Math.floor((totalMinutes % (24 * 60)) / 60);
      const minutes = totalMinutes % 60;
      const parts: string[] = [];

      if (days > 0) parts.push(t('heteroAgent.quota.duration.day', { count: days }));
      if (hours > 0) parts.push(t('heteroAgent.quota.duration.hour', { count: hours }));
      if (minutes > 0 && parts.length < 2)
        parts.push(t('heteroAgent.quota.duration.minute', { count: minutes }));

      return parts.join(' ');
    },
    [t],
  );
};

const LoadRow = ({ label, load }: { label: string; load: WindowLoad }) => {
  const { t } = useTranslation('chat');
  const formatDuration = useFormatDuration();
  const low = load.level === 'low';
  const exhausted = load.level === 'exhausted';

  return (
    <>
      <span {...stylex.props(styles.label)}>{label}</span>
      <div {...stylex.props(styles.track)}>
        <div
          className={stylex.props(styles.fill, low && styles.fillLow).className}
          data-load-level={load.level}
          style={{ width: `${load.leftPercent}%` }}
        />
      </div>
      <span
        {...stylex.props(styles.value, low && styles.valueLow, exhausted && styles.valueExhausted)}
      >
        {exhausted ? t('heteroAgent.quota.exhausted') : `${load.leftPercent}%`}
      </span>
      <span
        {...stylex.props(styles.reset)}
        title={
          load.resetsInMs
            ? t('heteroAgent.quota.resetsIn', { duration: formatDuration(load.resetsInMs) })
            : undefined
        }
      >
        {load.resetsInMs ? formatDuration(load.resetsInMs) : ''}
      </span>
    </>
  );
};

const stop = (event: SyntheticEvent) => event.stopPropagation();

interface LoadAccountCardProps {
  account: QuotaAccount;
  checked: boolean;
  /** Inline rename, replacing the name while it is open. */
  editing?: {
    busy: boolean;
    label: string;
    onCancel: () => void;
    onChange: (label: string) => void;
    onSave: () => void;
  };
  load: AccountLoad;
  /** Picking this card is not possible right now (loading, saving, read-only, not signed in). */
  locked: boolean;
  /** Absent for a read-only viewer. */
  menuItems?: DropdownMenuProps['items'];
  /** This device has no login for the account, so runs here cannot use it. */
  notSignedIn?: boolean;
  onSelect: () => void;
  /** Auto mode would send the next run here. */
  routing: boolean;
  /** The sign-in action shown with {@link notSignedIn}; absent for a read-only viewer. */
  signIn?: ReactNode;
}

/** One account's load in the balancing pool; picking the card pins runs to it. */
export const LoadAccountCard = memo<LoadAccountCardProps>(
  ({
    account,
    checked,
    editing,
    load,
    locked,
    menuItems,
    notSignedIn,
    onSelect,
    routing,
    signIn,
  }) => {
    const { t } = useTranslation('chat');
    const { email, name } = accountLines(account);
    const select = () => {
      if (!locked) onSelect();
    };

    return (
      <div
        aria-checked={checked}
        aria-disabled={locked || undefined}
        role={'radio'}
        tabIndex={locked ? -1 : 0}
        {...stylex.props(
          styles.card,
          !locked && styles.clickable,
          checked && styles.checked,
          locked && styles.locked,
        )}
        onClick={select}
        onKeyDown={(event: KeyboardEvent) => {
          if (event.target !== event.currentTarget) return;
          if (event.key !== ' ' && event.key !== 'Enter') return;
          event.preventDefault();
          select();
        }}
      >
        <Flexbox horizontal align={'center'} gap={10} style={{ minWidth: 0 }}>
          {isSubscriptionProvider(account.provider) && providerAvatar(account.provider, 28)}
          {editing ? (
            <div {...stylex.props(styles.rename)} onClick={stop} onKeyDown={stop}>
              <Input
                autoFocus
                placeholder={account.email || t('heteroAgent.claudeQuota.manage.labelPlaceholder')}
                size={'small'}
                style={{ flex: 1, minWidth: 0 }}
                value={editing.label}
                onChange={(e) => editing.onChange(e.target.value)}
                onPressEnter={editing.onSave}
              />
              <ActionIcon
                aria-label={i18nT('save', { ns: 'common' })}
                disabled={editing.busy}
                icon={CheckIcon}
                size={'small'}
                style={{ flex: 'none' }}
                title={i18nT('save', { ns: 'common' })}
                onClick={editing.onSave}
              />
              <ActionIcon
                aria-label={i18nT('cancel', { ns: 'common' })}
                icon={XIcon}
                size={'small'}
                style={{ flex: 'none' }}
                title={i18nT('cancel', { ns: 'common' })}
                onClick={editing.onCancel}
              />
            </div>
          ) : (
            <Flexbox flex={1} gap={2} style={{ minWidth: 0 }}>
              <Flexbox horizontal align={'center'} gap={6} style={{ minWidth: 0 }}>
                <Text ellipsis style={{ fontSize: 13, fontWeight: checked ? 600 : 500 }}>
                  {name}
                </Text>
                {account.planTier && (
                  <Tag size={'small'} style={{ flex: 'none' }}>
                    {displayPlanTier(account)}
                  </Tag>
                )}
              </Flexbox>
              {(routing || email) && (
                <Flexbox horizontal align={'center'} gap={6} style={{ minWidth: 0 }}>
                  {routing && (
                    <Tag
                      color={'success'}
                      icon={<Icon icon={ZapIcon} size={12} />}
                      size={'small'}
                      style={{ flex: 'none' }}
                    >
                      {t('heteroAgent.agentAccounts.routingNow')}
                    </Tag>
                  )}
                  {email && (
                    <Text ellipsis fontSize={12} type={'secondary'}>
                      {email}
                    </Text>
                  )}
                </Flexbox>
              )}
            </Flexbox>
          )}
          {!editing && menuItems && (
            <span {...stylex.props(styles.controls)} onClick={stop} onKeyDown={stop}>
              <DropdownMenu items={menuItems} placement={'bottomRight'}>
                <ActionIcon
                  aria-label={t('heteroAgent.claudeQuota.manage.more')}
                  icon={MoreHorizontalIcon}
                  size={'small'}
                  style={{ flex: 'none' }}
                  title={t('heteroAgent.claudeQuota.manage.more')}
                />
              </DropdownMenu>
            </span>
          )}
          <span aria-hidden {...stylex.props(styles.dot, checked && styles.dotChecked)} />
        </Flexbox>

        {notSignedIn ? (
          <Flexbox horizontal align={'center'} gap={8} justify={'space-between'}>
            <Text fontSize={12} type={'secondary'}>
              {t('heteroAgent.claudeQuota.manage.notSignedIn')}
            </Text>
            {signIn && (
              <span {...stylex.props(styles.controls)} onClick={stop} onKeyDown={stop}>
                {signIn}
              </span>
            )}
          </Flexbox>
        ) : load.session || load.weekly ? (
          <div {...stylex.props(styles.loads)}>
            {load.session && <LoadRow label={t('heteroAgent.quota.session')} load={load.session} />}
            {load.weekly && <LoadRow label={t('heteroAgent.quota.weekly')} load={load.weekly} />}
          </div>
        ) : (
          <Text fontSize={12} type={'secondary'}>
            {t('heteroAgent.agentAccounts.noUsage')}
          </Text>
        )}
      </div>
    );
  },
);

LoadAccountCard.displayName = 'LoadAccountCard';

/** Not tied to one account: let the balancer pick for each run. */
export const AutoBalanceCard = memo<{
  checked: boolean;
  hint?: ReactNode;
  locked: boolean;
  onSelect: () => void;
}>(({ checked, hint, locked, onSelect }) => {
  const { t } = useTranslation('chat');
  const select = () => {
    if (!locked) onSelect();
  };

  return (
    <div
      aria-checked={checked}
      aria-disabled={locked || undefined}
      role={'radio'}
      tabIndex={locked ? -1 : 0}
      {...stylex.props(
        styles.card,
        !locked && styles.clickable,
        checked && styles.checked,
        locked && styles.locked,
      )}
      onClick={select}
      onKeyDown={(event: KeyboardEvent) => {
        if (event.key !== ' ' && event.key !== 'Enter') return;
        event.preventDefault();
        select();
      }}
    >
      <Flexbox horizontal align={'center'} gap={10}>
        <Flexbox flex={1} gap={2} style={{ minWidth: 0 }}>
          <Text style={{ fontSize: 13, fontWeight: checked ? 600 : 500 }}>
            {t('heteroAgent.claudeQuota.manage.modeAuto')}
          </Text>
          <Text fontSize={12} type={'secondary'}>
            {hint ?? t('heteroAgent.claudeQuota.manage.modeAutoHint')}
          </Text>
        </Flexbox>
        <span aria-hidden {...stylex.props(styles.dot, checked && styles.dotChecked)} />
      </Flexbox>
    </div>
  );
});

AutoBalanceCard.displayName = 'AutoBalanceCard';
