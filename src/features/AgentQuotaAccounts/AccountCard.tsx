'use client';

import { displayPlanTier } from '@lobechat/heterogeneous-agents/quota';
import { ActionIcon, Checkbox, Flexbox, Icon, Tag, Text } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { PlusIcon, XIcon } from 'lucide-react';
import { memo } from 'react';

import { providerAvatar } from '@/features/SubscriptionAccounts/AccountRow';
import { isSubscriptionProvider } from '@/features/SubscriptionAccounts/accountView';
import { type QuotaAccount } from '@/store/agentQuota';

import { accountLines } from './accountLines';

const styles = stylex.create({
  card: {
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    minWidth: 0,
    minHeight: '62px',
    paddingBlock: '12px',
    paddingInline: '12px',
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
  // Same treatment as the driver tiles: the chosen ones are outlined and filled.
  checked: {
    borderColor: cssVar.colorText,
    backgroundColor: { 'default': cssVar.colorFillTertiary, ':hover': cssVar.colorFillTertiary },
  },
  disabled: { cursor: 'not-allowed', opacity: 0.5 },
  // The card owns the click and the keyboard; the box only shows the state.
  box: { flex: 'none', pointerEvents: 'none' },
  add: {
    justifyContent: 'center',
    width: '100%',
    borderStyle: 'dashed',
    color: cssVar.colorTextSecondary,
    fontFamily: 'inherit',
  },
});

/** Avatar, name with plan tier, and the sign-in email when the name is something else. */
const AccountSummary = ({ account, bold }: { account: QuotaAccount; bold?: boolean }) => {
  const { email, name } = accountLines(account);

  return (
    <>
      {isSubscriptionProvider(account.provider) && providerAvatar(account.provider, 28)}
      <Flexbox flex={1} gap={2} style={{ minWidth: 0 }}>
        <Flexbox horizontal align={'center'} gap={6} style={{ minWidth: 0 }}>
          <Text ellipsis style={{ fontSize: 13, fontWeight: bold ? 600 : 500 }}>
            {name}
          </Text>
          {account.planTier && (
            <Tag size={'small'} style={{ flex: 'none' }}>
              {displayPlanTier(account)}
            </Tag>
          )}
        </Flexbox>
        {email && (
          <Text ellipsis fontSize={12} type={'secondary'}>
            {email}
          </Text>
        )}
      </Flexbox>
    </>
  );
};

interface LinkedAccountCardProps {
  account: QuotaAccount;
  /** Taking the authorization back is not possible right now, e.g. while a write is in flight. */
  busy?: boolean;
  /** Absent for a read-only member: the card then has no remove button. */
  onRemove?: () => void;
  removeLabel: string;
}

/** An account this agent is authorized to run on; the button on the right takes the authorization back. */
export const LinkedAccountCard = memo<LinkedAccountCardProps>(
  ({ account, busy, onRemove, removeLabel }) => (
    <div {...stylex.props(styles.card)}>
      <AccountSummary account={account} />
      {onRemove && (
        <ActionIcon
          aria-label={removeLabel}
          disabled={busy}
          icon={XIcon}
          size={'small'}
          style={{ flex: 'none' }}
          title={removeLabel}
          onClick={onRemove}
        />
      )}
    </div>
  ),
);

LinkedAccountCard.displayName = 'LinkedAccountCard';

interface SelectableAccountCardProps {
  account: QuotaAccount;
  checked: boolean;
  disabled?: boolean;
  onToggle: (checked: boolean) => void;
}

/** A pool account to pick in the add dialog: the whole card is the checkbox. */
export const SelectableAccountCard = memo<SelectableAccountCardProps>(
  ({ account, checked, disabled, onToggle }) => {
    const toggle = () => {
      if (!disabled) onToggle(!checked);
    };

    return (
      <div
        aria-checked={checked}
        aria-disabled={disabled || undefined}
        role={'checkbox'}
        tabIndex={disabled ? -1 : 0}
        {...stylex.props(
          styles.card,
          styles.clickable,
          checked && styles.checked,
          disabled && styles.disabled,
        )}
        onClick={toggle}
        onKeyDown={(event) => {
          if (event.key !== ' ' && event.key !== 'Enter') return;
          event.preventDefault();
          toggle();
        }}
      >
        <AccountSummary account={account} bold={checked} />
        <Checkbox
          aria-hidden
          checked={checked}
          className={stylex.props(styles.box).className}
          disabled={disabled}
          tabIndex={-1}
        />
      </div>
    );
  },
);

SelectableAccountCard.displayName = 'SelectableAccountCard';

/** The dashed tile after the linked accounts that opens the add dialog. */
export const AddAccountCard = memo<{ label: string; onClick: () => void }>(({ label, onClick }) => (
  <button
    type={'button'}
    {...stylex.props(styles.card, styles.clickable, styles.add)}
    onClick={onClick}
  >
    <Icon icon={PlusIcon} size={16} />
    <Text style={{ color: 'inherit', fontSize: 13 }}>{label}</Text>
  </button>
));

AddAccountCard.displayName = 'AddAccountCard';
