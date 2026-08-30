'use client';

import type { BuiltinRenderProps } from '@lobechat/types';
import { Flexbox, Highlighter } from '@lobehub/ui';
import { Text } from '@lobehub/ui/base-ui';
import { createStaticStyles } from 'antd-style';
import { memo } from 'react';

import type { WebSearchArgs, WebSearchPluginState, WebSearchResult } from '../../../types';

const styles = createStaticStyles(({ css, cssVar }) => ({
  hostname: css`
    overflow: hidden;

    font-size: 12px;
    color: ${cssVar.colorTextTertiary};
    text-overflow: ellipsis;
    white-space: nowrap;
  `,
  metadata: css`
    overflow: hidden;

    min-width: 0;

    font-size: 12px;
    color: ${cssVar.colorTextSecondary};
    text-overflow: ellipsis;
    white-space: nowrap;
  `,
  queryRow: css`
    align-items: center;
    justify-content: space-between;

    min-width: 0;
    padding-block: 2px;
    padding-inline: 4px;
  `,
  resultItem: css`
    min-width: 0;
    padding-block: 5px;
    padding-inline: 4px;
    border-block-end: 1px solid ${cssVar.colorSplit};

    &:last-child {
      border-block-end: 0;
    }
  `,
  root: css`
    overflow: auto;
    min-width: 0;
    max-height: 280px;
    padding-block: 2px;
  `,
  snippet: css`
    font-size: 12px;
    line-height: 1.45;
    color: ${cssVar.colorTextSecondary};
  `,
  title: css`
    overflow: hidden;

    font-size: 13px;
    font-weight: 500;
    line-height: 1.45;
    color: ${cssVar.colorText};
    text-overflow: ellipsis;
    white-space: nowrap;

    &:hover {
      color: ${cssVar.colorLink};
    }
  `,
}));

const getWebSearchHostname = (link: string): string | undefined => {
  try {
    const url = new URL(link);
    return url.protocol === 'http:' || url.protocol === 'https:'
      ? url.hostname || undefined
      : undefined;
  } catch {
    return;
  }
};

const isWebSearchResult = (value: unknown): value is WebSearchResult => {
  if (!value || typeof value !== 'object') return false;

  const { link } = value as Partial<WebSearchResult>;
  return typeof link === 'string' && !!getWebSearchHostname(link);
};

const WebSearch = memo<BuiltinRenderProps<WebSearchArgs, WebSearchPluginState>>(
  ({ args, content, pluginState }) => {
    const results = pluginState?.results?.filter(isWebSearchResult) ?? [];

    if (results.length === 0) {
      if (!content) return null;

      return (
        <Highlighter
          wrap
          language={'text'}
          showLanguage={false}
          style={{ maxHeight: 240, overflow: 'auto' }}
          variant={'borderless'}
        >
          {content}
        </Highlighter>
      );
    }

    const query = pluginState?.query || args?.query;
    const duration =
      typeof pluginState?.durationSeconds === 'number' &&
      Number.isFinite(pluginState.durationSeconds) &&
      pluginState.durationSeconds >= 0
        ? `${pluginState.durationSeconds.toFixed(2)}s`
        : undefined;

    return (
      <Flexbox className={styles.root} gap={0}>
        {(query || duration) && (
          <Flexbox horizontal className={styles.queryRow} gap={8}>
            <span className={styles.metadata}>{query}</span>
            {duration && <span className={styles.metadata}>{duration}</span>}
          </Flexbox>
        )}
        {results.map((result, index) => {
          const hostname = getWebSearchHostname(result.link);
          const title = result.title || hostname || result.link;

          return (
            <Flexbox className={styles.resultItem} gap={3} key={`${result.link}-${index}`}>
              <a href={result.link} rel={'noreferrer'} target={'_blank'}>
                <span className={styles.title}>{title}</span>
              </a>
              <Text className={styles.hostname}>{hostname || result.link}</Text>
              {result.snippet && <Text className={styles.snippet}>{result.snippet}</Text>}
            </Flexbox>
          );
        })}
      </Flexbox>
    );
  },
);

WebSearch.displayName = 'ClaudeCodeWebSearch';

export default WebSearch;
