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

import { type CodexWebSearchArgs, getWebSearchQuery } from './webSearchUtils';

const WebSearchInspector = memo<BuiltinInspectorProps<CodexWebSearchArgs, CodexWebSearchArgs>>(
  ({ args, partialArgs, pluginState, isArgumentsStreaming, isLoading }) => {
    const { t } = useTranslation('plugin');
    const label = t('builtins.codex.apiName.web_search', { defaultValue: 'Search the web' });
    const query =
      getWebSearchQuery(args) || getWebSearchQuery(partialArgs) || getWebSearchQuery(pluginState);

    if (isArgumentsStreaming && !query) {
      return <div className={cx(inspectorTextStyles.root, shinyTextStyles.shinyText)}>{label}</div>;
    }

    return (
      <div
        className={cx(
          inspectorTextStyles.root,
          (isArgumentsStreaming || isLoading) && shinyTextStyles.shinyText,
        )}
      >
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

WebSearchInspector.displayName = 'CodexWebSearchInspector';

export default WebSearchInspector;
