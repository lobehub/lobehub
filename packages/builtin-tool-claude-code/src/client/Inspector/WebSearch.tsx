'use client';

import {
  highlightTextStyles,
  inspectorTextStyles,
  shinyTextStyles,
} from '@lobechat/shared-tool-ui/styles';
import type { BuiltinInspectorProps } from '@lobechat/types';
import { cx } from 'antd-style';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { ClaudeCodeApiName, type WebSearchArgs } from '../../types';

export const WebSearchInspector = memo<BuiltinInspectorProps<WebSearchArgs>>(
  ({ args, partialArgs, isArgumentsStreaming, isLoading }) => {
    const { t } = useTranslation('plugin');
    const label = t(ClaudeCodeApiName.WebSearch as any);
    const query = (args?.query || partialArgs?.query || '').trim();

    if (isArgumentsStreaming && !query) {
      return <div className={cx(inspectorTextStyles.root, shinyTextStyles.shinyText)}>{label}</div>;
    }

    const isShiny = isArgumentsStreaming || isLoading;

    return (
      <div className={cx(inspectorTextStyles.root, isShiny && shinyTextStyles.shinyText)}>
        <span>{label}</span>
        {query && (
          <>
            <span>: </span>
            <span className={highlightTextStyles.primary}>{query}</span>
          </>
        )}
      </div>
    );
  },
);

WebSearchInspector.displayName = 'ClaudeCodeWebSearchInspector';
