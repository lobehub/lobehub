'use client';

import { type WorkspaceConnectorMemberManage } from '@lobechat/types';
import { Flexbox, Select, Text, toast } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useConnectorManagePolicy } from '@/hooks/useConnectorManagePolicy';
import { updateConnectorManagePolicy } from '@/services/connectorManagePolicy';

const styles = stylex.create({
  root: {
    borderBlockEndColor: cssVar.colorBorderSecondary,
    borderBlockEndStyle: 'solid',
    borderBlockEndWidth: 1,
    flexShrink: 0,
    paddingBlock: 10,
    paddingInline: 16,
  },
});

/**
 * Workspace owners and admins choose whether members may maintain the shared
 * connectors. A restricted member gets one line saying so here instead of a
 * repeated label on every row, which only offers "Ask an admin".
 */
const ConnectorManagePolicy = memo(() => {
  const { t } = useTranslation('setting');
  const { data: policy } = useConnectorManagePolicy();
  const [updating, setUpdating] = useState(false);

  if (!policy) return null;

  if (!policy.canEditPolicy) {
    if (policy.canManage) return null;
    return (
      <Text fontSize={12} type={'secondary'} {...stylex.props(styles.root)}>
        {t('tools.connectorFeedback.restricted')}
      </Text>
    );
  }

  const handleChange = async (value: WorkspaceConnectorMemberManage) => {
    setUpdating(true);
    try {
      await updateConnectorManagePolicy(value);
    } catch {
      toast.error(t('tools.connectorPolicy.updateFailed'));
    } finally {
      setUpdating(false);
    }
  };

  return (
    <Flexbox gap={8} {...stylex.props(styles.root)}>
      <Flexbox gap={2}>
        <Text strong fontSize={13}>
          {t('tools.connectorPolicy.title')}
        </Text>
        <Text fontSize={12} type={'secondary'}>
          {t('tools.connectorPolicy.desc')}
        </Text>
      </Flexbox>
      <Select
        disabled={updating}
        size={'small'}
        value={policy.memberManage}
        options={[
          { label: t('tools.connectorPolicy.options.allMembers'), value: 'all_members' },
          { label: t('tools.connectorPolicy.options.onlyAdmins'), value: 'admins_only' },
        ]}
        onChange={(value) => void handleChange(value as WorkspaceConnectorMemberManage)}
      />
    </Flexbox>
  );
});

ConnectorManagePolicy.displayName = 'ConnectorManagePolicy';

export default ConnectorManagePolicy;
