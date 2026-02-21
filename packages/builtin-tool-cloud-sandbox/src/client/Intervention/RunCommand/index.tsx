'use client';

import type { BuiltinInterventionProps } from '@lobechat/types';
import { Flexbox, Highlighter, Text } from '@lobehub/ui';
import { memo } from 'react';

interface RunCommandParams {
  background?: boolean;
  command: string;
  timeout?: number;
}

const formatTimeout = (ms?: number) => {
  if (!ms) return null;
  const seconds = ms / 1000;
  if (seconds >= 60) return `${(seconds / 60).toFixed(1)}min`;
  if (seconds >= 1) return `${seconds.toFixed(1)}s`;
  return `${ms}ms`;
};

const RunCommand = memo<BuiltinInterventionProps<RunCommandParams>>(({ args }) => {
  const { command, timeout, background } = args;
  return (
    <Flexbox gap={8}>
      <Flexbox horizontal justify={'space-between'}>
        <Text>Execute command in cloud sandbox</Text>
        <Flexbox horizontal gap={8}>
          {background && (
            <Text style={{ fontSize: 12 }} type={'secondary'}>
              background
            </Text>
          )}
          {timeout && (
            <Text style={{ fontSize: 12 }} type={'secondary'}>
              timeout: {formatTimeout(timeout)}
            </Text>
          )}
        </Flexbox>
      </Flexbox>
      {command && (
        <Highlighter
          wrap
          language={'sh'}
          showLanguage={false}
          style={{ padding: '4px 8px' }}
          variant={'outlined'}
        >
          {command}
        </Highlighter>
      )}
    </Flexbox>
  );
});

export default RunCommand;
