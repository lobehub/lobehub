'use client';

import type { BuiltinRenderProps } from '@lobechat/types';
import { Block, Highlighter } from '@lobehub/ui';
import { memo } from 'react';

import type { WriteLocalFileState } from '../../../types';

interface WriteLocalFileParams {
  content: string;
  createDirectories?: boolean;
  path: string;
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

const WriteFile = memo<BuiltinRenderProps<WriteLocalFileParams, WriteLocalFileState>>(
  ({ args }) => {
    if (!args?.content) {
      return null;
    }

    const ext = getFileExtension(args.path);
    const language = getLanguageFromExtension(ext);

    return (
      <Block padding={8} variant={'outlined'}>
        <Highlighter
          showLanguage
          wrap
          language={language}
          style={{ maxHeight: 400, overflow: 'auto' }}
          variant={'borderless'}
        >
          {args.content}
        </Highlighter>
      </Block>
    );
  },
);

WriteFile.displayName = 'WriteFile';

export default WriteFile;
