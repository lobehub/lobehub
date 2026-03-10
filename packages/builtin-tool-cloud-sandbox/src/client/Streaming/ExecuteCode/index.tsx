'use client';

import type { BuiltinStreamingProps } from '@lobechat/types';
import { Highlighter } from '@lobehub/ui';
import { memo } from 'react';

interface ExecuteCodeParams {
  code?: string;
  description?: string;
  language?: 'javascript' | 'python' | 'typescript';
}

const languageDisplayNames: Record<string, string> = {
  javascript: 'JavaScript',
  python: 'Python',
  typescript: 'TypeScript',
};

export const ExecuteCodeStreaming = memo<BuiltinStreamingProps<ExecuteCodeParams>>(({ args }) => {
  const { code, language = 'python' } = args || {};

  const displayLanguage = languageDisplayNames[language] || language;

  // Don't render if no code yet
  if (!code) return null;

  return (
    <Highlighter
      animated
      wrap
      language={displayLanguage}
      showLanguage={false}
      style={{ padding: '4px 8px' }}
      variant={'outlined'}
    >
      {code}
    </Highlighter>
  );
});

ExecuteCodeStreaming.displayName = 'ExecuteCodeStreaming';
