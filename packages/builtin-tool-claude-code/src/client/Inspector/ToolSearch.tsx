'use client';

import {
  highlightTextStyles,
  inspectorTextStyles,
  shinyTextStyles,
} from '@lobechat/shared-tool-ui/styles';
import type { BuiltinInspectorProps } from '@lobechat/types';
import { cx } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { ClaudeCodeApiName, type ToolSearchArgs } from '../../types';

const SELECT_PREFIX = 'select:';

const styles = stylex.create({
  baseline: { alignItems: 'baseline' },
  tag: {
    paddingBlock: '2px',
    paddingInline: '10px',
    borderRadius: '999px',
    fontFamily: cssVar.fontFamilyCode,
    fontSize: '12px',
    color: cssVar.colorText,
    background: cssVar.colorFillTertiary,
  },
  tagsList: {
    display: 'inline-flex',
    flexShrink: 1,
    gap: '4px',
    alignItems: 'center',
    minWidth: '0',
    marginInlineStart: '6px',
    whiteSpace: 'nowrap',
  },
});

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
        <div className={cx(stylex.props(styles.baseline).className, inspectorTextStyles.root)}>
          <span className={cx(isShiny && shinyTextStyles.shinyText)}>{label}:</span>
          <span {...stylex.props(styles.tagsList)}>
            {parsed.names.map((name, index) => (
              <span {...stylex.props(styles.tag)} key={`${index}-${name}`}>
                {name}
              </span>
            ))}
          </span>
        </div>
      );
    }

    return (
      <div className={inspectorTextStyles.root}>
        <span className={cx(isShiny && shinyTextStyles.shinyText)}>{label}</span>
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
