'use client';

import type { BuiltinInterventionProps } from '@lobechat/types';
import { Flexbox, Highlighter, Text } from '@lobehub/ui';
import { memo } from 'react';

interface EditLocalFileParams {
  all?: boolean;
  path: string;
  replace: string;
  search: string;
}

const EditLocalFile = memo<BuiltinInterventionProps<EditLocalFileParams>>(({ args }) => {
  const { path, search, replace, all } = args;

  return (
    <Flexbox gap={8}>
      <Text>
        Edit file: {path} {all && '(replace all)'}
      </Text>
      <Flexbox gap={4}>
        <Text style={{ fontSize: 12 }} type={'secondary'}>
          Search:
        </Text>
        <Highlighter
          wrap
          language={'text'}
          showLanguage={false}
          style={{ padding: '4px 8px' }}
          variant={'outlined'}
        >
          {search}
        </Highlighter>
      </Flexbox>
      <Flexbox gap={4}>
        <Text style={{ fontSize: 12 }} type={'secondary'}>
          Replace with:
        </Text>
        <Highlighter
          wrap
          language={'text'}
          showLanguage={false}
          style={{ padding: '4px 8px' }}
          variant={'outlined'}
        >
          {replace}
        </Highlighter>
      </Flexbox>
    </Flexbox>
  );
});

export default EditLocalFile;
