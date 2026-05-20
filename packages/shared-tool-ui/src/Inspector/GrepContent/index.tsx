'use client';

import type { GrepContentState } from '@lobechat/tool-runtime';
import type { BuiltinInspectorProps } from '@lobechat/types';
import { Text } from '@lobehub/ui';
import { createStaticStyles, cssVar, cx } from 'antd-style';
import { Fragment, memo } from 'react';
import { useTranslation } from 'react-i18next';

import { inspectorTextStyles, shinyTextStyles } from '../../styles';

const styles = createStaticStyles(({ css, cssVar }) => ({
  baseline: css`
    align-items: baseline;
  `,
  separator: css`
    margin-inline: 2px;
    color: ${cssVar.colorTextQuaternary};
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

const splitPattern = (pattern: string): string[] =>
  pattern
    .split('|')
    .map((part) => part.trim())
    .filter(Boolean);

const PatternTags = memo<{ pattern: string }>(({ pattern }) => {
  const parts = splitPattern(pattern);
  if (parts.length === 0) return null;

  return (
    <span className={styles.tagsList}>
      {parts.map((part, index) => (
        <Fragment key={`${index}-${part}`}>
          {index > 0 && <span className={styles.separator}>|</span>}
          <span className={styles.tag}>{part}</span>
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
            <div className={cx(inspectorTextStyles.root, shinyTextStyles.shinyText)}>
              <span>{t(translationKey as any)}</span>
            </div>
          );

        return (
          <div className={cx(inspectorTextStyles.root, styles.baseline, shinyTextStyles.shinyText)}>
            <span>{t(translationKey as any)}:</span>
            <PatternTags pattern={pattern} />
          </div>
        );
      }

      const resultCount = pluginState?.totalMatches ?? 0;
      const hasResults = resultCount > 0;

      return (
        <div
          className={cx(
            inspectorTextStyles.root,
            styles.baseline,
            isLoading && shinyTextStyles.shinyText,
          )}
        >
          <span>{t(translationKey as any)}:</span>
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
