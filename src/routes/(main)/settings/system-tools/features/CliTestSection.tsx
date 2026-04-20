'use client';

import { Button, Flexbox, Input, Text } from '@lobehub/ui';
import { memo, useCallback, useState } from 'react';

import { electronSystemService } from '@/services/electron/system';

interface CommandResult {
  args: string;
  exitCode: number;
  stderr: string;
  stdout: string;
}

const CliTestSection = memo(() => {
  const [results, setResults] = useState<CommandResult[]>([]);
  const [running, setRunning] = useState(false);
  const [customCmd, setCustomCmd] = useState('');

  const runCommand = useCallback(async (args: string) => {
    setRunning(true);
    try {
      const result = await electronSystemService.runCliCommand(args);
      setResults((prev) => [...prev, { args, ...result }]);
    } catch (error: any) {
      setResults((prev) => [...prev, { args, exitCode: -1, stderr: String(error), stdout: '' }]);
    } finally {
      setRunning(false);
    }
  }, []);

  const presetCommands = ['--version', '--help', 'status'];

  return (
    <Flexbox gap={16} style={{ marginTop: 24 }}>
      <Text style={{ fontSize: 18, fontWeight: 600 }}>CLI Embedded Test</Text>

      <Flexbox horizontal gap={8} wrap="wrap">
        {presetCommands.map((cmd) => (
          <Button key={cmd} loading={running} size="small" onClick={() => runCommand(cmd)}>
            lobehub {cmd}
          </Button>
        ))}
      </Flexbox>

      <Flexbox horizontal gap={8}>
        <Input
          placeholder="Custom args (e.g. connect --help)"
          style={{ flex: 1 }}
          value={customCmd}
          onChange={(e) => setCustomCmd(e.target.value)}
          onPressEnter={() => customCmd && runCommand(customCmd)}
        />
        <Button
          disabled={!customCmd}
          loading={running}
          size="small"
          type="primary"
          onClick={() => runCommand(customCmd)}
        >
          Run
        </Button>
      </Flexbox>

      {results.map((r, i) => (
        <Flexbox
          gap={4}
          key={i}
          style={{
            background: 'var(--ant-color-fill-quaternary)',
            borderRadius: 8,
            fontFamily: 'monospace',
            fontSize: 12,
            padding: 12,
          }}
        >
          <Text style={{ color: 'var(--ant-color-primary)', fontWeight: 600 }}>
            $ lobehub {r.args} (exit: {r.exitCode})
          </Text>
          {r.stdout && (
            <pre style={{ margin: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
              {r.stdout}
            </pre>
          )}
          {r.stderr && (
            <pre
              style={{
                color: 'var(--ant-color-error)',
                margin: 0,
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-all',
              }}
            >
              {r.stderr}
            </pre>
          )}
        </Flexbox>
      ))}
    </Flexbox>
  );
});

export default CliTestSection;
