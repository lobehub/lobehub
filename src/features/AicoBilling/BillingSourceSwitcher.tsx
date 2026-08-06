'use client';

import { Center, Flexbox, Text } from '@lobehub/ui';
import { createStaticStyles, cx } from 'antd-style';
import { CheckIcon, ChevronDownIcon, WalletIcon } from 'lucide-react';
import { memo, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { toastAicoError } from '@/business/client/resolveAicoErrorMessage';
import ActionDropdown from '@/features/ChatInput/ActionBar/components/ActionDropdown';

import { type AicoBillingContext, type AicoBillingSource, formatRemainingUsd } from './types';
import { useAicoBillingSources } from './useAicoBillingSources';

const styles = createStaticStyles(({ css, cssVar }) => ({
  check: css`
    color: ${cssVar.colorTextSecondary};
  `,
  chevron: css`
    color: ${cssVar.colorTextQuaternary};
  `,
  label: css`
    overflow: hidden;

    max-width: 110px;

    font-size: 12px;
    color: ${cssVar.colorTextSecondary};
    text-overflow: ellipsis;
    white-space: nowrap;
  `,
  remaining: css`
    font-size: 12px;
    font-variant-numeric: tabular-nums;
    color: ${cssVar.colorText};
  `,
  row: css`
    display: flex;
    gap: 8px;
    align-items: center;
    justify-content: space-between;

    width: 100%;
    min-width: 0;
  `,
  trigger: css`
    cursor: pointer;
    border-radius: 6px;

    :hover {
      background: ${cssVar.colorFillTertiary};
    }
  `,
  triggerReadonly: css`
    cursor: default;

    &:hover {
      background: transparent;
    }
  `,
}));

const sourceLabel = (
  source: AicoBillingSource,
  t: (key: string, opts?: Record<string, string>) => string,
): string => {
  if (source.source === 'personal') return t('billing.personal');
  return source.organizationName || t('billing.organization');
};

const sourceToContext = (source: AicoBillingSource): AicoBillingContext =>
  source.source === 'personal'
    ? { source: 'personal' }
    : { organizationId: source.organizationId, source: 'organization' };

const BillingSourceSwitcher = memo(() => {
  const { t } = useTranslation('aico');
  const [busy, setBusy] = useState(false);
  const { activeSource, canSwitch, data, isLoading, isSelected, selectSource } =
    useAicoBillingSources();

  const menuItems = useMemo(() => {
    if (!data?.sources.length) return [];

    return data.sources.map((source) => {
      const ctx = sourceToContext(source);
      const selected = isSelected(ctx);
      const label = sourceLabel(source, t);
      const remaining = formatRemainingUsd(source.remainingUsd);

      return {
        icon: selected ? CheckIcon : WalletIcon,
        key: source.source === 'personal' ? 'personal' : `org:${source.organizationId}`,
        label: (
          <div className={styles.row}>
            <Flexbox gap={2} style={{ minWidth: 0 }}>
              <Text
                style={{
                  fontSize: 13,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {label}
              </Text>
              <Text style={{ fontSize: 11 }} type="secondary">
                {t('billing.remaining', { amount: remaining })}
              </Text>
            </Flexbox>
            {selected ? <CheckIcon className={styles.check} size={14} /> : null}
          </div>
        ),
        onClick: async () => {
          if (selected || busy) return;
          setBusy(true);
          try {
            await selectSource(ctx);
          } catch (err) {
            toastAicoError(err, t, 'billing.switchFailed');
          } finally {
            setBusy(false);
          }
        },
      };
    });
  }, [busy, data?.sources, isSelected, selectSource, t]);

  if (isLoading && !activeSource) return null;
  if (!activeSource) return null;

  const label = sourceLabel(activeSource, t);
  const remaining = formatRemainingUsd(activeSource.remainingUsd);

  const trigger = (
    <Center
      horizontal
      aria-label={t('billing.switcherAria', { label, remaining })}
      className={cx(styles.trigger, !canSwitch && styles.triggerReadonly)}
      gap={4}
      height={28}
      paddingInline={6}
    >
      <WalletIcon size={12} style={{ opacity: 0.65 }} />
      <span className={styles.label}>{label}</span>
      <span className={styles.remaining}>{remaining}</span>
      {canSwitch ? <ChevronDownIcon className={styles.chevron} size={12} /> : null}
    </Center>
  );

  if (!canSwitch) return trigger;

  return (
    <ActionDropdown menu={{ items: menuItems }} minWidth={240} placement="top" trigger="click">
      {trigger}
    </ActionDropdown>
  );
});

BillingSourceSwitcher.displayName = 'BillingSourceSwitcher';

export default BillingSourceSwitcher;
