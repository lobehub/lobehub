'use client';

import type { BuiltinInspectorProps } from '@lobechat/types';
import { Flexbox } from '@lobehub/ui';
import { createStaticStyles, cx } from 'antd-style';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { highlightTextStyles, shinyTextStyles } from '@/styles';

import type { GetAgentDetailParams } from '../../../types';

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

export const GetAgentDetailInspector = memo<BuiltinInspectorProps<GetAgentDetailParams>>(
  ({ args, partialArgs, isArgumentsStreaming }) => {
    const { t } = useTranslation('plugin');

    const agentId = args?.agentId || partialArgs?.agentId;

    if (isArgumentsStreaming && !agentId) {
      return (
        <div className={cx(styles.root, shinyTextStyles.shinyText)}>
          <span>{t('builtins.lobe-agent-management.apiName.getAgentDetail')}</span>
        </div>
      );
    }

    return (
      <Flexbox
        horizontal
        align={'center'}
        className={cx(styles.root, isArgumentsStreaming && shinyTextStyles.shinyText)}
        gap={8}
      >
        <span className={styles.title}>
          {t('builtins.lobe-agent-management.inspector.getAgentDetail.title')}
        </span>
        {agentId && <span className={highlightTextStyles.primary}>{agentId}</span>}
      </Flexbox>
    );
  },
);

GetAgentDetailInspector.displayName = 'GetAgentDetailInspector';

export default GetAgentDetailInspector;
