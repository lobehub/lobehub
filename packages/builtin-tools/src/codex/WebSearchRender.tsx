'use client';

import type { BuiltinRenderProps } from '@lobechat/types';
import { Flexbox, Text } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import {
  type CodexWebSearchArgs,
  getWebSearchOutput,
  getWebSearchQuery,
  getWebSearchResults,
} from './webSearchUtils';

const styles = stylex.create({
  output: {
    overflow: 'auto',
    maxHeight: '280px',
    margin: '0',
    paddingBlock: '2px',
    paddingInline: '4px',
    fontFamily: cssVar.fontFamily,
    fontSize: '13px',
    lineHeight: 1.55,
    color: cssVar.colorTextSecondary,
    whiteSpace: 'pre-wrap',
  },
  query: {
    overflow: 'hidden',
    minWidth: '0',
    color: cssVar.colorText,
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  queryLabel: { flexShrink: 0, color: cssVar.colorTextTertiary },
  queryRow: {
    gap: '6px',
    alignItems: 'center',
    paddingBlock: '2px',
    paddingInline: '4px',
    fontSize: '12px',
  },
  resultItem: {
    minWidth: '0',
    paddingBlock: '5px',
    paddingInline: '4px',
    borderBlockEndWidth: '1px',
    borderBlockEndStyle: { 'default': 'solid', ':last-child': 'none' },
    borderBlockEndColor: cssVar.colorSplit,
  },
  resultList: { gap: '0', minWidth: '0' },
  root: { gap: '4px', minWidth: '0', paddingBlock: '2px' },
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
  url: {
    overflow: 'hidden',
    fontSize: '12px',
    color: cssVar.colorTextTertiary,
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
});

const WebSearchRender = memo<BuiltinRenderProps<CodexWebSearchArgs, CodexWebSearchArgs>>(
  ({ args, content, pluginState }) => {
    const { t } = useTranslation('plugin');
    const query = getWebSearchQuery(args) || getWebSearchQuery(pluginState);
    const argResults = getWebSearchResults(args, content);
    const results = argResults.length > 0 ? argResults : getWebSearchResults(pluginState);
    const output = results.length > 0 ? '' : getWebSearchOutput(content);

    if (!query && results.length === 0 && !output) return null;

    return (
      <Flexbox className={stylex.props(styles.root).className}>
        {query && (
          <Flexbox horizontal className={stylex.props(styles.queryRow).className}>
            <span {...stylex.props(styles.queryLabel)}>
              {t('builtins.codex.webSearch.query', { defaultValue: 'Query' })}
            </span>
            <span {...stylex.props(styles.query)}>{query}</span>
          </Flexbox>
        )}
        {results.length > 0 && (
          <Flexbox className={stylex.props(styles.resultList).className}>
            {results.map((result, index) => {
              const key = result.url || `${result.title}-${index}`;
              const title = <span {...stylex.props(styles.title)}>{result.title}</span>;

              return (
                <Flexbox className={stylex.props(styles.resultItem).className} gap={3} key={key}>
                  {result.url ? (
                    <a href={result.url} rel={'noreferrer'} target={'_blank'}>
                      {title}
                    </a>
                  ) : (
                    title
                  )}
                  {result.url && (
                    <Text className={stylex.props(styles.url).className}>{result.url}</Text>
                  )}
                  {result.snippet && (
                    <Text className={stylex.props(styles.snippet).className}>{result.snippet}</Text>
                  )}
                </Flexbox>
              );
            })}
          </Flexbox>
        )}
        {output && <pre {...stylex.props(styles.output)}>{output}</pre>}
      </Flexbox>
    );
  },
);

WebSearchRender.displayName = 'CodexWebSearchRender';

export default WebSearchRender;
