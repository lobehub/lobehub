'use client';

import { type BuiltinRenderProps } from '@lobechat/types';
import { Block, Flexbox, Highlighter, Markdown, Text } from '@lobehub/ui';
import { createStaticStyles } from 'antd-style';
import { memo } from 'react';

import type { ReadReferenceParams, ReadReferenceState } from '../../../types';

const styles = createStaticStyles(({ css }) => ({
  container: css`
    overflow: hidden;
    padding-inline: 8px 0;
  `,
}));

const getFileExtension = (path: string): string => {
  const parts = path.split('.');
  return parts.length > 1 ? parts.pop()?.toLowerCase() || 'text' : 'text';
};

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
  xsd: 'xml',
  yaml: 'yaml',
  yml: 'yaml',
};

const getLanguage = (ext: string): string => languageMap[ext] || 'text';

const formatSize = (bytes: number): string => {
  if (bytes === 0) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

const ReadReference = memo<BuiltinRenderProps<ReadReferenceParams, ReadReferenceState>>(
  ({ content, pluginState }) => {
    const { encoding, path, size } = pluginState || {};

    if (!path || !content) return null;

    const ext = getFileExtension(path);
    const isMarkdown = ext === 'md' || ext === 'markdown';
    const isBinary = encoding === 'base64';

    const sizeText = size ? formatSize(size) : '';

    return (
      <Flexbox className={styles.container} gap={8}>
        <Flexbox align={'center'} horizontal justify={'space-between'}>
          <Text as={'span'} code ellipsis fontSize={12}>
            {path}
          </Text>
          {sizeText && (
            <Text as={'span'} code fontSize={12} type={'secondary'}>
              {sizeText}
            </Text>
          )}
        </Flexbox>

        {isBinary ? (
          <Block padding={12} variant={'outlined'}>
            <Text fontSize={12} type={'secondary'}>
              Binary file ({sizeText})
            </Text>
          </Block>
        ) : isMarkdown ? (
          <Block padding={12} variant={'outlined'}>
            <Markdown style={{ overflow: 'unset' }} variant={'chat'}>
              {content}
            </Markdown>
          </Block>
        ) : (
          <Block padding={0} variant={'outlined'}>
            <Highlighter
              language={getLanguage(ext)}
              showLanguage
              style={{ maxHeight: 400, overflow: 'auto' }}
              variant={'borderless'}
              wrap
            >
              {content}
            </Highlighter>
          </Block>
        )}
      </Flexbox>
    );
  },
);

ReadReference.displayName = 'ReadReference';

export default ReadReference;
