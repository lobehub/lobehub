'use client';

import type { BuiltinInspectorProps } from '@lobechat/types';
import { Avatar, Flexbox } from '@lobehub/ui';
import { createStaticStyles, cssVar, cx } from 'antd-style';
import { Check } from 'lucide-react';
import { memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { shinyTextStyles } from '@/styles';

import type { BatchCreateAgentsParams, BatchCreateAgentsState } from '../../../types';

const styles = createStaticStyles(({ css, cssVar: cv }) => ({
  avatarGroup: css`
    display: flex;
    gap: 2px;
    align-items: center;
  `,
  count: css`
    font-size: 12px;
    color: ${cv.colorTextSecondary};
  `,
  root: css`
    overflow: hidden;
    display: flex;
    gap: 8px;
    align-items: center;
  `,
  statusIcon: css`
    flex-shrink: 0;
    margin-block-end: -2px;
  `,
  title: css`
    flex-shrink: 0;
    color: ${cv.colorTextSecondary};
    white-space: nowrap;
  `,
}));

export const BatchCreateAgentsInspector = memo<
  BuiltinInspectorProps<BatchCreateAgentsParams, BatchCreateAgentsState>
>(({ args, partialArgs, isArgumentsStreaming, isLoading, pluginState }) => {
  const { t } = useTranslation('plugin');

  const agents = args?.agents || partialArgs?.agents;

  // Get display info from agents
  const displayInfo = useMemo(() => {
    if (!agents || agents.length === 0) return null;

    const count = agents.length;
    const displayAgents = agents.slice(0, 3); // Show up to 3 avatars

    return { count, displayAgents };
  }, [agents]);

  // Initial streaming state
  if (isArgumentsStreaming && !displayInfo) {
    return (
      <div className={cx(styles.root, shinyTextStyles.shinyText)}>
        <span>{t('builtins.lobe-group-agent-builder.apiName.batchCreateAgents')}</span>
      </div>
    );
  }

  const isSuccess = pluginState?.successCount === pluginState?.agents?.length;
  const successCount = pluginState?.successCount ?? 0;
  const totalCount = displayInfo?.count ?? 0;

  return (
    <Flexbox
      horizontal
      align={'center'}
      className={cx(styles.root, (isArgumentsStreaming || isLoading) && shinyTextStyles.shinyText)}
      gap={8}
    >
      <span className={styles.title}>
        {t('builtins.lobe-group-agent-builder.apiName.batchCreateAgents')}:
      </span>
      {displayInfo && (
        <>
          <div className={styles.avatarGroup}>
            {displayInfo.displayAgents?.map((agent, index) => (
              <Avatar
                avatar={agent.avatar}
                key={index}
                shape={'square'}
                size={20}
                title={agent.title}
              />
            ))}
          </div>
          <span className={styles.count}>
            {pluginState
              ? `${successCount}/${totalCount}`
              : `${totalCount} ${t('builtins.lobe-group-agent-builder.inspector.agents')}`}
          </span>
        </>
      )}
      {!isLoading && isSuccess && (
        <Check className={styles.statusIcon} color={cssVar.colorSuccess} size={14} />
      )}
    </Flexbox>
  );
});

BatchCreateAgentsInspector.displayName = 'BatchCreateAgentsInspector';

export default BatchCreateAgentsInspector;
