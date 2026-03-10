import type { RunCommandParams } from '@lobechat/electron-client-ipc';
import type { BuiltinInterventionProps } from '@lobechat/types';
import { Flexbox, Highlighter, Text } from '@lobehub/ui';
import { memo } from 'react';

const formatTimeout = (ms?: number) => {
  if (!ms) return null;

  const seconds = ms / 1000;

  // >= 60s 显示分钟
  if (seconds >= 60) {
    const minutes = seconds / 60;
    return `${minutes.toFixed(1)}min`;
  }

  // >= 1s 显示秒
  if (seconds >= 1) {
    return `${seconds.toFixed(1)}s`;
  }

  // < 1s 显示毫秒
  return `${ms}ms`;
};

const RunCommand = memo<BuiltinInterventionProps<RunCommandParams>>(({ args }) => {
  const { description, command, timeout } = args;
  return (
    <Flexbox gap={8}>
      <Flexbox horizontal justify={'space-between'}>
        {description && <Text>{description}</Text>}
        {timeout && (
          <Text style={{ fontSize: 12 }} type={'secondary'}>
            timeout: {formatTimeout(timeout)}
          </Text>
        )}
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
