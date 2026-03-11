'use client';

import type { BuiltinRenderProps } from '@lobechat/types';
import { Block, Flexbox, Highlighter, Text } from '@lobehub/ui';
import { createStaticStyles } from 'antd-style';
import { memo } from 'react';

import type { ReadLocalFileState } from '../../../types';

const styles = createStaticStyles(({ css }) => ({
  container: css`
    overflow: hidden;
    padding-inline: 8px 0;
  `,
}));

interface ReadLocalFileParams {
  endLine?: number;
  path: string;
  startLine?: number;
}

/**
 * Get file extension from path
 */
const getFileExtension = (path: string): string => {
  const parts = path.split('.');
  return parts.length > 1 ? parts.pop()?.toLowerCase() || 'text' : 'text';
};

/**
 * Map file extension to Highlighter language
 */
const getLanguageFromExtension = (ext: string): string => {
  const languageMap: Record<string, string> = {
    css: 'css',
    go: 'go',
    html: 'html',
    java: 'java',
    js: 'javascript',
    json: 'json',
    jsx: 'jsx',
    md: 'markdown',
    py: 'python',
    rs: 'rust',
    scss: 'scss',
    sh: 'bash',
    sql: 'sql',
    ts: 'typescript',
    tsx: 'tsx',
    xml: 'xml',
    yaml: 'yaml',
    yml: 'yaml',
  };
  return languageMap[ext] || 'text';
};

const ReadLocalFile = memo<BuiltinRenderProps<ReadLocalFileParams, ReadLocalFileState>>(
  ({ args, pluginState }) => {
    if (!pluginState?.content) {
      return null;
    }

    const ext = getFileExtension(args.path);
    const language = getLanguageFromExtension(ext);

    const lineInfo =
      pluginState.startLine || pluginState.endLine
        ? `Lines ${pluginState.startLine || 1}-${pluginState.endLine || pluginState.totalLines || '?'}`
        : pluginState.totalLines
          ? `${pluginState.totalLines} lines`
          : '';

    return (
      <Flexbox className={styles.container} gap={8}>
        {/* File path and info */}
        <Flexbox horizontal align={'center'} justify={'space-between'}>
          <Text code ellipsis as={'span'} fontSize={12}>
            📄 {args.path}
          </Text>
          {lineInfo && (
            <Text code as={'span'} fontSize={12} type={'secondary'}>
              {lineInfo}
            </Text>
          )}
        </Flexbox>

        {/* File content */}
        <Block padding={0} variant={'outlined'}>
          <Highlighter
            showLanguage
            wrap
            language={language}
            style={{ maxHeight: 400, overflow: 'auto' }}
            variant={'borderless'}
          >
            {pluginState.content}
          </Highlighter>
        </Block>
      </Flexbox>
    );
  },
);

ReadLocalFile.displayName = 'ReadLocalFile';

export default ReadLocalFile;
