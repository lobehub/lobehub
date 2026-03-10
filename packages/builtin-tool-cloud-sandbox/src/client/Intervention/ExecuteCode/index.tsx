'use client';

import type { BuiltinInterventionProps } from '@lobechat/types';
import { Flexbox, Highlighter, Text } from '@lobehub/ui';
import { memo } from 'react';

interface ExecuteCodeParams {
  code: string;
  language?: 'javascript' | 'python' | 'typescript';
}

const languageDisplayNames: Record<string, string> = {
  javascript: 'JavaScript',
  python: 'Python',
  typescript: 'TypeScript',
};

const ExecuteCode = memo<BuiltinInterventionProps<ExecuteCodeParams>>(({ args }) => {
  const { code, language = 'python' } = args;
  const displayLanguage = languageDisplayNames[language] || language;

  return (
    <Flexbox gap={8}>
      <Flexbox horizontal justify={'space-between'}>
        <Text>Execute code in cloud sandbox</Text>
        <Text style={{ fontSize: 12 }} type={'secondary'}>
          {displayLanguage}
        </Text>
      </Flexbox>
      {code && (
        <Highlighter
          wrap
          language={language}
          showLanguage={false}
          style={{ padding: '4px 8px' }}
          variant={'outlined'}
        >
          {code}
        </Highlighter>
      )}
    </Flexbox>
  );
});

export default ExecuteCode;
