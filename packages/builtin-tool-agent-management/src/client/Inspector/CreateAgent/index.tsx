'use client';

import type { BuiltinInspectorProps } from '@lobechat/types';
import { createStaticStyles, cx, Flexbox, useTheme } from '@lobehub/ui';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import AgentAvatar from '@/components/AgentAvatar';
import { highlightTextStyles, shinyTextStyles } from '@/styles';

import type { CreateAgentParams } from '../../../types';

const styles = createStaticStyles(({ css, cssVar }) => ({
  root: css`
    overflow: hidden;
    display: flex;
    gap: 8px;
    align-items: center;
  `,
  title: css`
    flex-shrink: 0;
    color: ${cssVar.colorTextSecondary};
    white-space: nowrap;
  `,
}));

export const CreateAgentInspector = memo<BuiltinInspectorProps<CreateAgentParams>>(
  ({ args, partialArgs, isArgumentsStreaming }) => {
    const { t } = useTranslation('plugin');
    const theme = useTheme();

    const title = args?.title || partialArgs?.title;
    const avatar = args?.avatar || partialArgs?.avatar;
    const backgroundColor = args?.backgroundColor || partialArgs?.backgroundColor;

    if (isArgumentsStreaming && !title) {
      return (
        <div className={styles.root}>
          <span className={shinyTextStyles.shinyText}>
            {t('builtins.lobe-agent-management.apiName.createAgent')}
          </span>
        </div>
      );
    }

    return (
      <Flexbox horizontal align={'center'} className={styles.root} gap={8}>
        <span className={cx(styles.title, isArgumentsStreaming && shinyTextStyles.shinyText)}>
          {t('builtins.lobe-agent-management.inspector.createAgent.title')}
        </span>
        <AgentAvatar
          avatar={avatar}
          background={backgroundColor || theme.colorBgContainer}
          shape={'square'}
          size={24}
          title={title || undefined}
        />
        {title && <span className={highlightTextStyles.primary}>{title}</span>}
      </Flexbox>
    );
  },
);

CreateAgentInspector.displayName = 'CreateAgentInspector';

export default CreateAgentInspector;
