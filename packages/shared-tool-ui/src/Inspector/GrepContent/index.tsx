'use client';

import type { GrepContentState } from '@lobechat/tool-runtime';
import type { BuiltinInspectorProps } from '@lobechat/types';
import { cx, Text } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { Fragment, memo } from 'react';
import { useTranslation } from 'react-i18next';

import { inspectorTextStyles, shinyTextStyles } from '../../styles';

const styles = stylex.create({
  baseline: { alignItems: 'baseline' },
  separator: { marginInline: '2px', color: cssVar.colorTextQuaternary },
  tag: {
    paddingBlock: '1px',
    paddingInline: '6px',
    borderRadius: '4px',
    fontFamily: cssVar.fontFamilyCode,
    fontSize: '12px',
    color: cssVar.colorText,
    backgroundColor: cssVar.colorFillTertiary,
    backgroundImage: 'none',
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

const splitPattern = (pattern: string): string[] =>
  pattern
    .split('|')
    .map((part) => part.trim())
    .filter(Boolean);

const PatternTags = memo<{ pattern: string }>(({ pattern }) => {
  const parts = splitPattern(pattern);
  if (parts.length === 0) return null;

  return (
    <span {...stylex.props(styles.tagsList)}>
      {parts.map((part, index) => (
        <Fragment key={`${index}-${part}`}>
          {index > 0 && <span {...stylex.props(styles.separator)}>|</span>}
          <span {...stylex.props(styles.tag)}>{part}</span>
        </Fragment>
      ))}
    </span>
  );
});
PatternTags.displayName = 'GrepPatternTags';

interface GrepContentArgs {
  directory?: string;
  path?: string;
  pattern?: string;
}

interface CreateGrepContentInspectorOptions {
  noResultsKey: string;
  translationKey: string;
}

export const createGrepContentInspector = ({
  translationKey,
  noResultsKey,
}: CreateGrepContentInspectorOptions) => {
  const Inspector = memo<BuiltinInspectorProps<GrepContentArgs, GrepContentState>>(
    ({ args, partialArgs, isArgumentsStreaming, pluginState, isLoading }) => {
      const { t } = useTranslation('plugin');

      const pattern = args?.pattern || partialArgs?.pattern || '';

      if (isArgumentsStreaming) {
        if (!pattern)
          return (
            <div className={inspectorTextStyles.root}>
              <span className={shinyTextStyles.shinyText}>{t(translationKey as any)}</span>
            </div>
          );

        return (
          <div className={cx(stylex.props(styles.baseline).className, inspectorTextStyles.root)}>
            <span className={shinyTextStyles.shinyText}>{t(translationKey as any)}:</span>
            <PatternTags pattern={pattern} />
          </div>
        );
      }

      const resultCount = pluginState?.totalMatches ?? 0;
      const hasResults = resultCount > 0;

      return (
        <div className={cx(stylex.props(styles.baseline).className, inspectorTextStyles.root)}>
          <span className={cx(isLoading && shinyTextStyles.shinyText)}>
            {t(translationKey as any)}:
          </span>
          {pattern && <PatternTags pattern={pattern} />}
          {!isLoading &&
            pluginState &&
            (hasResults ? (
              <span style={{ marginInlineStart: 4 }}>({resultCount})</span>
            ) : (
              <Text
                as={'span'}
                color={cssVar.colorTextDescription}
                fontSize={12}
                style={{ marginInlineStart: 4 }}
              >
                ({t(noResultsKey as any)})
              </Text>
            ))}
        </div>
      );
    },
  );
  Inspector.displayName = 'GrepContentInspector';
  return Inspector;
};
