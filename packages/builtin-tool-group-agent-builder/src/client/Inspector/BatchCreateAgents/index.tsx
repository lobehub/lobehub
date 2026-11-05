'use client';

import type { BuiltinInspectorProps } from '@lobechat/types';
import { Avatar, cx, Flexbox } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { Check } from 'lucide-react';
import { memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { shinyTextStyles } from '@/styles';

import type { BatchCreateAgentsParams, BatchCreateAgentsState } from '../../../types';

const styles = stylex.create({
  avatarGroup: { display: 'flex', gap: '2px', alignItems: 'center' },
  count: { fontSize: '12px', color: cssVar.colorTextSecondary },
  root: { overflow: 'hidden', display: 'flex', gap: '8px', alignItems: 'center' },
  statusIcon: { flexShrink: 0, marginBlockEnd: '-2px' },
  title: { flexShrink: 0, color: cssVar.colorTextSecondary, whiteSpace: 'nowrap' },
});

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
      <div {...stylex.props(styles.root)}>
        <span className={shinyTextStyles.shinyText}>
          {t('builtins.lobe-group-agent-builder.apiName.batchCreateAgents')}
        </span>
      </div>
    );
  }

  const isSuccess = pluginState?.successCount === pluginState?.agents?.length;
  const successCount = pluginState?.successCount ?? 0;
  const totalCount = displayInfo?.count ?? 0;

  return (
    <Flexbox horizontal align={'center'} className={stylex.props(styles.root).className} gap={8}>
      <span
        className={cx(
          stylex.props(styles.title).className,
          (isArgumentsStreaming || isLoading) && shinyTextStyles.shinyText,
        )}
      >
        {t('builtins.lobe-group-agent-builder.apiName.batchCreateAgents')}:
      </span>
      {displayInfo && (
        <>
          <div {...stylex.props(styles.avatarGroup)}>
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
          <span {...stylex.props(styles.count)}>
            {pluginState
              ? `${successCount}/${totalCount}`
              : `${totalCount} ${t('builtins.lobe-group-agent-builder.inspector.agents')}`}
          </span>
        </>
      )}
      {!isLoading && isSuccess && (
        <Check
          className={stylex.props(styles.statusIcon).className}
          color={cssVar.colorSuccess}
          size={14}
        />
      )}
    </Flexbox>
  );
});

BatchCreateAgentsInspector.displayName = 'BatchCreateAgentsInspector';

export default BatchCreateAgentsInspector;
