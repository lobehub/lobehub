'use client';

import type { BuiltinInspectorProps } from '@lobechat/types';
import { cx, Flexbox } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { highlightTextStyles, shinyTextStyles } from '@/styles';

import type { DuplicateAgentParams } from '../../../types';

const styles = stylex.create({
  root: { overflow: 'hidden', display: 'flex', gap: '8px', alignItems: 'center' },
  title: { flexShrink: 0, color: cssVar.colorTextSecondary, whiteSpace: 'nowrap' },
});

export const DuplicateAgentInspector = memo<BuiltinInspectorProps<DuplicateAgentParams>>(
  ({ args, partialArgs, isArgumentsStreaming }) => {
    const { t } = useTranslation('plugin');

    const agentId = args?.agentId || partialArgs?.agentId;
    const newTitle = args?.newTitle || partialArgs?.newTitle;

    if (isArgumentsStreaming && !agentId) {
      return (
        <div {...stylex.props(styles.root)}>
          <span className={shinyTextStyles.shinyText}>
            {t('builtins.lobe-agent-management.apiName.duplicateAgent')}
          </span>
        </div>
      );
    }

    return (
      <Flexbox horizontal align={'center'} className={stylex.props(styles.root).className} gap={8}>
        <span
          className={cx(
            stylex.props(styles.title).className,
            isArgumentsStreaming && shinyTextStyles.shinyText,
          )}
        >
          {t('builtins.lobe-agent-management.inspector.duplicateAgent.title')}
        </span>
        <span className={highlightTextStyles.primary}>{newTitle || agentId}</span>
      </Flexbox>
    );
  },
);

DuplicateAgentInspector.displayName = 'DuplicateAgentInspector';

export default DuplicateAgentInspector;
