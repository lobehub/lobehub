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

import { ClaudeCodeApiName, type ToolSearchArgs } from '../../types';

const SELECT_PREFIX = 'select:';

/**
 * `select:A,B,C` → `A, B, C` (names the model is loading by exact match).
 * Keyword queries pass through unchanged.
 */
const formatQuery = (query?: string): string | undefined => {
  if (!query) return undefined;
  const trimmed = query.trim();
  if (!trimmed.toLowerCase().startsWith(SELECT_PREFIX)) return trimmed;
  const names = trimmed
    .slice(SELECT_PREFIX.length)
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  return names.length > 0 ? names.join(', ') : trimmed;
};

export const ToolSearchInspector = memo<BuiltinInspectorProps<ToolSearchArgs>>(
  ({ args, partialArgs, isArgumentsStreaming, isLoading }) => {
    const { t } = useTranslation('plugin');
    const label = t(ClaudeCodeApiName.ToolSearch as any);
    const query = formatQuery(args?.query || partialArgs?.query);

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

ToolSearchInspector.displayName = 'ClaudeCodeToolSearchInspector';
