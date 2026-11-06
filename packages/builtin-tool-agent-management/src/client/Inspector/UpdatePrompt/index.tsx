'use client';

import type { BuiltinInspectorProps } from '@lobechat/types';
import { cx, Flexbox } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { highlightTextStyles, shinyTextStyles } from '@/styles';

import type { UpdatePromptParams } from '../../../types';

const styles = stylex.create({
  root: { overflow: 'hidden', display: 'flex', gap: '8px', alignItems: 'center' },
  title: { flexShrink: 0, color: cssVar.colorTextSecondary, whiteSpace: 'nowrap' },
});

export const UpdatePromptInspector = memo<BuiltinInspectorProps<UpdatePromptParams>>(
  ({ args, partialArgs, isArgumentsStreaming }) => {
    const { t } = useTranslation('plugin');

    const agentId = args?.agentId || partialArgs?.agentId;

    if (isArgumentsStreaming && !agentId) {
      return (
        <div {...stylex.props(styles.root)}>
          <span className={shinyTextStyles.shinyText}>
            {t('builtins.lobe-agent-management.apiName.updatePrompt')}
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
          {t('builtins.lobe-agent-management.inspector.updatePrompt.title')}
        </span>
        {agentId && <span className={highlightTextStyles.primary}>{agentId}</span>}
      </Flexbox>
    );
  },
);

UpdatePromptInspector.displayName = 'UpdatePromptInspector';

export default UpdatePromptInspector;
