'use client';

import {
  highlightTextStyles,
  inspectorTextStyles,
  shinyTextStyles,
} from '@lobechat/shared-tool-ui/styles';
import type { BuiltinInspectorProps } from '@lobechat/types';
import { createStaticStyles, cx } from 'antd-style';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { ClaudeCodeApiName, type ToolSearchArgs } from '../../types';

const SELECT_PREFIX = 'select:';

const styles = createStaticStyles(({ css, cssVar }) => ({
  baseline: css`
    align-items: baseline;
  `,
  tag: css`
    padding-block: 1px;
    padding-inline: 6px;
    border-radius: 4px;

    font-family: ${cssVar.fontFamilyCode};
    font-size: 12px;
    color: ${cssVar.colorText};

    background: ${cssVar.colorFillTertiary};
  `,
  tagsList: css`
    display: inline-flex;
    flex-shrink: 1;
    gap: 4px;
    align-items: center;

    min-width: 0;
    margin-inline-start: 6px;

    white-space: nowrap;
  `,
}));

interface ParsedQuery {
  names: string[] | null;
  raw: string;
}

/**
 * `select:A,B,C` → ['A', 'B', 'C'] (exact-name loads, rendered as tags).
 * Keyword queries pass through as raw text.
 */
const parseQuery = (query?: string): ParsedQuery | undefined => {
  if (!query) return undefined;
  const trimmed = query.trim();
  if (!trimmed.toLowerCase().startsWith(SELECT_PREFIX)) {
    return { names: null, raw: trimmed };
  }
  const names = trimmed
    .slice(SELECT_PREFIX.length)
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  return { names: names.length > 0 ? names : null, raw: trimmed };
};

export const ToolSearchInspector = memo<BuiltinInspectorProps<ToolSearchArgs>>(
  ({ args, partialArgs, isArgumentsStreaming, isLoading }) => {
    const { t } = useTranslation('plugin');
    const label = t(ClaudeCodeApiName.ToolSearch as any);
    const parsed = parseQuery(args?.query || partialArgs?.query);

    if (isArgumentsStreaming && !parsed) {
      return <div className={cx(inspectorTextStyles.root, shinyTextStyles.shinyText)}>{label}</div>;
    }

    const isShiny = isArgumentsStreaming || isLoading;

    if (parsed?.names) {
      return (
        <div
          className={cx(
            inspectorTextStyles.root,
            styles.baseline,
            isShiny && shinyTextStyles.shinyText,
          )}
        >
          <span>{label}:</span>
          <span className={styles.tagsList}>
            {parsed.names.map((name, index) => (
              <span className={styles.tag} key={`${index}-${name}`}>
                {name}
              </span>
            ))}
          </span>
        </div>
      );
    }

    return (
      <div className={cx(inspectorTextStyles.root, isShiny && shinyTextStyles.shinyText)}>
        <span>{label}</span>
        {parsed && (
          <>
            <span>: </span>
            <span className={highlightTextStyles.primary}>{parsed.raw}</span>
          </>
        )}
      </div>
    );
  },
);

ToolSearchInspector.displayName = 'ClaudeCodeToolSearchInspector';
