'use client';

import type { BuiltinRenderProps } from '@lobechat/types';
import { Flexbox, Text } from '@lobehub/ui';
import { createStaticStyles } from 'antd-style';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import {
  type CodexWebSearchArgs,
  getWebSearchOutput,
  getWebSearchQuery,
  getWebSearchResults,
} from './webSearchUtils';

const styles = createStaticStyles(({ css, cssVar }) => ({
  output: css`
    overflow: auto;

    max-height: 280px;
    margin: 0;
    padding-block: 2px;
    padding-inline: 4px;

    font-family: ${cssVar.fontFamily};
    font-size: 13px;
    line-height: 1.55;
    color: ${cssVar.colorTextSecondary};
    white-space: pre-wrap;
  `,
  query: css`
    overflow: hidden;

    min-width: 0;

    color: ${cssVar.colorText};
    text-overflow: ellipsis;
    white-space: nowrap;
  `,
  queryLabel: css`
    flex-shrink: 0;
    color: ${cssVar.colorTextTertiary};
  `,
  queryRow: css`
    gap: 6px;
    align-items: center;

    padding-block: 2px;
    padding-inline: 4px;

    font-size: 12px;
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
  resultList: css`
    gap: 0;
    min-width: 0;
  `,
  root: css`
    gap: 4px;
    min-width: 0;
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
  url: css`
    overflow: hidden;

    font-size: 12px;
    color: ${cssVar.colorTextTertiary};
    text-overflow: ellipsis;
    white-space: nowrap;
  `,
}));

const WebSearchRender = memo<BuiltinRenderProps<CodexWebSearchArgs>>(({ args, content }) => {
  const { t } = useTranslation('plugin');
  const query = getWebSearchQuery(args);
  const results = getWebSearchResults(args, content);
  const output = results.length > 0 ? '' : getWebSearchOutput(content);

  if (!query && results.length === 0 && !output) return null;

  return (
    <Flexbox className={styles.root}>
      {query && (
        <Flexbox horizontal className={styles.queryRow}>
          <span className={styles.queryLabel}>
            {t('builtins.codex.webSearch.query', { defaultValue: 'Query' })}
          </span>
          <span className={styles.query}>{query}</span>
        </Flexbox>
      )}
      {results.length > 0 && (
        <Flexbox className={styles.resultList}>
          {results.map((result, index) => {
            const key = result.url || `${result.title}-${index}`;
            const title = <span className={styles.title}>{result.title}</span>;

            return (
              <Flexbox className={styles.resultItem} gap={3} key={key}>
                {result.url ? (
                  <a href={result.url} rel={'noreferrer'} target={'_blank'}>
                    {title}
                  </a>
                ) : (
                  title
                )}
                {result.url && <Text className={styles.url}>{result.url}</Text>}
                {result.snippet && <Text className={styles.snippet}>{result.snippet}</Text>}
              </Flexbox>
            );
          })}
        </Flexbox>
      )}
      {output && <pre className={styles.output}>{output}</pre>}
    </Flexbox>
  );
});

WebSearchRender.displayName = 'CodexWebSearchRender';

export default WebSearchRender;
