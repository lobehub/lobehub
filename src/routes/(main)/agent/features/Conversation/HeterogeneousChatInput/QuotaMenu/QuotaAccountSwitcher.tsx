'use client';

import type { ClaudeCodeQuotaSnapshot } from '@lobechat/electron-client-ipc';
import { Flexbox, Text } from '@lobehub/ui';
import { Button } from '@lobehub/ui/base-ui';
import { createStaticStyles, cssVar } from 'antd-style';
import { memo, useCallback } from 'react';
import { useTranslation } from 'react-i18next';

import { useAgentId } from '@/features/ChatInput/hooks/useAgentId';

import { openQuotaAccountManagerModal } from './QuotaAccountManagerModal';

const styles = createStaticStyles(({ css }) => ({
  // Divider faces the quota windows: below when on top, above when it trails.
  bottom: css`
    padding-block-start: 8px;
    border-block-start: 1px solid ${cssVar.colorBorderSecondary};
  `,
  top: css`
    padding-block-end: 8px;
    border-block-end: 1px solid ${cssVar.colorBorderSecondary};
  `,
}));

/**
 * Compact account line in the quota panel: shows the account this quota belongs
 * to and a "Manage" entry into the full account-pool modal (mode / rotation /
 * per-account controls). The heavy lifting lives in QuotaAccountManagerModal.
 */
const QuotaAccountSwitcher = memo<{
  placement?: 'top' | 'bottom';
  snapshot: ClaudeCodeQuotaSnapshot;
}>(({ snapshot, placement = 'top' }) => {
  const { t } = useTranslation('chat');
  const agentId = useAgentId();
  const identity = snapshot.identity;

  const openManager = useCallback(() => {
    if (agentId) openQuotaAccountManagerModal(agentId);
  }, [agentId]);

  if (!agentId) return null;

  return (
    <Flexbox
      horizontal
      align={'center'}
      className={placement === 'top' ? styles.top : styles.bottom}
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
      </Flexbox>
      <Button size={'small'} style={{ flex: 'none' }} onClick={openManager}>
        {t('heteroAgent.claudeQuota.manage.entry')}
      </Button>
    </Flexbox>
  );
});

QuotaAccountSwitcher.displayName = 'QuotaAccountSwitcher';

export default QuotaAccountSwitcher;
