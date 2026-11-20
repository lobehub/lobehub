'use client';

import { type WorkspaceConnectorMemberManage } from '@lobechat/types';
import { Block, Flexbox, Select, Text, toast, Tooltip } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { UsersIcon } from 'lucide-react';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useConnectorManagePolicy } from '@/hooks/useConnectorManagePolicy';
import { updateConnectorManagePolicy } from '@/services/connectorManagePolicy';
import { densityTokens } from '@/styles/density.stylex';

import {
  type ConnectorManagePolicyVariant,
  resolveConnectorManagePolicyView,
} from './connectorManagePolicyView';

const styles = stylex.create({
  // One line under the page header, aligned with the rows' 12px inset.
  notice: { paddingBlockStart: '12px', paddingInline: '12px' },
  // The Codex scope dropdown ("Local"): a filled pill in the header toolbar.
  // No radius token reaches a pill.
  pill: { flex: 'none', width: '200px', borderRadius: '999px' },
  root: {
    borderBlockEndColor: cssVar.colorBorderSecondary,
    borderBlockEndStyle: 'solid',
    borderBlockEndWidth: 1,
    flexShrink: 0,
    paddingBlock: 10,
    paddingInline: densityTokens['--lobe-density-card-padding'],
  },
});

/**
 * Workspace owners and admins choose whether members may maintain the shared
 * connectors. A restricted member gets one line saying so here instead of a
 * repeated label on every row, which only offers "Ask an admin".
 */
interface ConnectorManagePolicyProps {
  /** See {@link ConnectorManagePolicyVariant}. */
  variant?: ConnectorManagePolicyVariant;
}

const ConnectorManagePolicy = memo<ConnectorManagePolicyProps>(({ variant = 'column' }) => {
  const { t } = useTranslation('setting');
  const { data: policy } = useConnectorManagePolicy();
  const [updating, setUpdating] = useState(false);

  const view = resolveConnectorManagePolicyView(policy, variant);
  if (!policy || view === 'none') return null;

  if (view === 'notice') {
    if (variant === 'page')
      return (
        <div {...stylex.props(styles.notice)}>
          <Block paddingBlock={10} paddingInline={16} variant={'filled'}>
            <Text type={'secondary'}>{t('tools.connectorFeedback.restricted')}</Text>
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

  const options = [
    { label: t('tools.connectorPolicy.options.allMembers'), value: 'all_members' },
    { label: t('tools.connectorPolicy.options.onlyAdmins'), value: 'admins_only' },
  ];
  const onChange = (value: unknown) => void handleChange(value as WorkspaceConnectorMemberManage);

  if (variant === 'toolbar')
    return (
      // The pill only names the choice; its title and what it governs ride on the tooltip.
      // `Select` forwards neither `aria-label` nor its trigger `id`, so a
      // labelled group names the control for assistive tech.
      <div aria-label={t('tools.connectorPolicy.title')} role={'group'}>
        <Tooltip
          placement={'bottom'}
          title={`${t('tools.connectorPolicy.title')} · ${t('tools.connectorPolicy.desc')}`}
        >
          <Select
            className={stylex.props(styles.pill).className}
            disabled={updating}
            options={options}
            prefix={UsersIcon}
            value={policy.memberManage}
            variant={'filled'}
            onChange={onChange}
          />
        </Tooltip>
      </div>
    );

  const select = (
    <Select
      disabled={updating}
      options={options}
      size={'small'}
      value={policy.memberManage}
      onChange={onChange}
    />
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
