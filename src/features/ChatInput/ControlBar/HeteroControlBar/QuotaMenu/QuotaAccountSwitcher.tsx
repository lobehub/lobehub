'use client';

import type { QuotaAccountIdentity } from '@lobechat/heterogeneous-agents/quota';
import { ActionIcon, Button, Flexbox, Text, usePopoverContext } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { CalendarDaysIcon } from 'lucide-react';
import { memo, useCallback } from 'react';
import { useTranslation } from 'react-i18next';

import { openQuotaCalendarModal, type QuotaCalendarProvider } from '@/features/AgentQuotaCalendar';
import { useAgentId } from '@/features/ChatInput/hooks/useAgentId';

import { openQuotaAccountManagerModal } from './QuotaAccountManagerModal';

const styles = stylex.create({
  bottom: {
    paddingBlockStart: '8px',
    borderBlockStartWidth: '1px',
    borderBlockStartStyle: 'solid',
    borderBlockStartColor: cssVar.colorBorderSecondary,
  },
  top: {
    paddingBlockEnd: '8px',
    borderBlockEndWidth: '1px',
    borderBlockEndStyle: 'solid',
    borderBlockEndColor: cssVar.colorBorderSecondary,
  },
});

/**
 * Compact account line in the quota panel: shows the account this quota belongs
 * to and a "Manage" entry into the full account-pool modal (mode / rotation /
 * per-account controls). The heavy lifting lives in QuotaAccountManagerModal.
 */
const QuotaAccountSwitcher = memo<{
  /** Bound execution device the panel samples; the manager checks logins there, not here. */
  deviceId?: string;
  placement?: 'top' | 'bottom';
  provider: QuotaCalendarProvider;
  snapshot: { identity?: QuotaAccountIdentity | null };
}>(({ deviceId, snapshot, provider, placement = 'top' }) => {
  const { t } = useTranslation('chat');
  const agentId = useAgentId();
  const identity = snapshot.identity;
  // Only rendered inside the quota popover; hand off to each modal without
  // leaving the popover open underneath it.
  const { close } = usePopoverContext();

  const openManager = useCallback(() => {
    if (!agentId) return;
    close();
    openQuotaAccountManagerModal(agentId, { deviceId });
  }, [agentId, close, deviceId]);

  if (!agentId) return null;

  return (
    <Flexbox
      horizontal
      align={'center'}
      className={stylex.props(placement === 'top' ? styles.top : styles.bottom).className}
      gap={8}
      justify={'space-between'}
    >
      <Flexbox horizontal align={'center'} gap={6} style={{ minWidth: 0 }}>
        <Text ellipsis style={{ fontSize: 12 }}>
          {identity?.displayName || identity?.email || t('heteroAgent.claudeQuota.accounts')}
        </Text>
        {identity?.planTier && (
          <Text style={{ flex: 'none', fontSize: 12 }} type={'secondary'}>
            {identity.planTier}
          </Text>
        )}
        <ActionIcon
          icon={CalendarDaysIcon}
          size={'small'}
          style={{ flex: 'none' }}
          title={t('heteroAgent.claudeQuota.calendar.entry')}
          onClick={() => {
            close();
            openQuotaCalendarModal({ externalAccountId: identity?.externalAccountId, provider });
          }}
        />
      </Flexbox>
      {/*
       * The account manager edits provider-blind agent bindings and runtime
       * routing only honors them for claude-code, so offering it from another
       * provider's panel could pin a foreign account onto Claude runs. Until
       * management and routing are provider-scoped end to end, the other
       * providers get a calendar-only header.
       */}
      {provider === 'claude-code' && (
        <Button size={'small'} style={{ flex: 'none' }} onClick={openManager}>
          {t('heteroAgent.claudeQuota.manage.entry')}
        </Button>
      )}
    </Flexbox>
  );
});

QuotaAccountSwitcher.displayName = 'QuotaAccountSwitcher';

export default QuotaAccountSwitcher;
