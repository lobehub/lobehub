'use client';

import type { BuiltinRenderProps } from '@lobechat/types';
import { Flexbox, Highlighter, Text } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { memo } from 'react';

import type { WebSearchArgs, WebSearchPluginState, WebSearchResult } from '../../../types';

const styles = stylex.create({
  hostname: {
    overflow: 'hidden',
    fontSize: '12px',
    color: cssVar.colorTextTertiary,
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  metadata: {
    overflow: 'hidden',
    minWidth: '0',
    fontSize: '12px',
    color: cssVar.colorTextSecondary,
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  queryRow: {
    alignItems: 'center',
    justifyContent: 'space-between',
    minWidth: '0',
    paddingBlock: '2px',
    paddingInline: '4px',
  },
  resultItem: {
    minWidth: '0',
    paddingBlock: '5px',
    paddingInline: '4px',
    borderBlockEndWidth: '1px',
    borderBlockEndStyle: { 'default': 'solid', ':last-child': 'none' },
    borderBlockEndColor: cssVar.colorSplit,
  },
  root: { overflow: 'auto', minWidth: '0', maxHeight: '280px', paddingBlock: '2px' },
  snippet: { fontSize: '12px', lineHeight: 1.45, color: cssVar.colorTextSecondary },
  title: {
    overflow: 'hidden',
    fontSize: '13px',
    fontWeight: 500,
    lineHeight: 1.45,
    color: { 'default': cssVar.colorText, ':hover': cssVar.colorLink },
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
});

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
      <Flexbox className={stylex.props(styles.root).className} gap={0}>
        {(query || duration) && (
          <Flexbox horizontal className={stylex.props(styles.queryRow).className} gap={8}>
            <span {...stylex.props(styles.metadata)}>{query}</span>
            {duration && <span {...stylex.props(styles.metadata)}>{duration}</span>}
          </Flexbox>
        )}
        {results.map((result, index) => {
          const hostname = getWebSearchHostname(result.link);
          const title = result.title || hostname || result.link;

          return (
            <Flexbox
              className={stylex.props(styles.resultItem).className}
              gap={3}
              key={`${result.link}-${index}`}
            >
              <a href={result.link} rel={'noreferrer'} target={'_blank'}>
                <span {...stylex.props(styles.title)}>{title}</span>
              </a>
              <Text className={stylex.props(styles.hostname).className}>
                {hostname || result.link}
              </Text>
              {result.snippet && (
                <Text className={stylex.props(styles.snippet).className}>{result.snippet}</Text>
              )}
            </Flexbox>
          );
        })}
      </Flexbox>
    );
  },
);

WebSearch.displayName = 'ClaudeCodeWebSearch';

export default WebSearch;
