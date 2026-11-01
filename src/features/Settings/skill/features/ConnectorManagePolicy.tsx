'use client';

import { type WorkspaceConnectorMemberManage } from '@lobechat/types';
import { Block, Flexbox, Select, Text, toast } from '@lobehub/ui';
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
interface ConnectorManagePolicyProps {
  /**
   * `column` is the bordered strip under the sidebar header; `page` is one
   * settings row (label left, control right) above the full-width list.
   */
  variant?: 'column' | 'page';
}

const ConnectorManagePolicy = memo<ConnectorManagePolicyProps>(({ variant = 'column' }) => {
  const { t } = useTranslation('setting');
  const { data: policy } = useConnectorManagePolicy();
  const [updating, setUpdating] = useState(false);

  if (!policy) return null;

  if (!policy.canEditPolicy) {
    if (policy.canManage) return null;
    if (variant === 'page')
      return (
        <div style={{ paddingInline: 12 }}>
          <Block paddingBlock={10} paddingInline={16} variant={'filled'}>
            <Text fontSize={13} type={'secondary'}>
              {t('tools.connectorFeedback.restricted')}
            </Text>
          </Block>
        </div>
      );
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

  const select = (
    <Select
      disabled={updating}
      size={variant === 'page' ? undefined : 'small'}
      style={variant === 'page' ? { flex: 'none', width: 180 } : undefined}
      value={policy.memberManage}
      options={[
        { label: t('tools.connectorPolicy.options.allMembers'), value: 'all_members' },
        { label: t('tools.connectorPolicy.options.onlyAdmins'), value: 'admins_only' },
      ]}
      onChange={(value) => void handleChange(value as WorkspaceConnectorMemberManage)}
    />
  );

  if (variant === 'page')
    return (
      <div style={{ paddingInline: 12 }}>
        <Block
          horizontal
          align={'center'}
          gap={16}
          justify={'space-between'}
          paddingBlock={12}
          paddingInline={16}
          variant={'filled'}
        >
          <Flexbox gap={2} style={{ minWidth: 0 }}>
            <Text strong fontSize={13}>
              {t('tools.connectorPolicy.title')}
            </Text>
            <Text fontSize={12} type={'secondary'}>
              {t('tools.connectorPolicy.desc')}
            </Text>
          </Flexbox>
          {select}
        </Block>
      </div>
    );

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
      {select}
    </Flexbox>
  );
});

ConnectorManagePolicy.displayName = 'ConnectorManagePolicy';

export default ConnectorManagePolicy;
