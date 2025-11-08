import { RunCommandParams } from '@lobechat/electron-client-ipc';
import { ChatMessagePluginError } from '@lobechat/types';
import { Terminal } from '@xterm/xterm';
import '@xterm/xterm/css/xterm.css';
import { memo, useEffect, useRef } from 'react';

import { LocalReadFileState } from '@/tools/local-system/type';

interface RunCommandProps {
  args: RunCommandParams;
  messageId: string;
  pluginError: ChatMessagePluginError;
  pluginState: LocalReadFileState;
}

const RunCommand = memo<RunCommandProps>(({ args }) => {
  const terminalRef = useRef(null);

  useEffect(() => {
    if (!terminalRef.current) return;

    const term = new Terminal({ cols: 80, cursorBlink: true, rows: 30 });

    term.open(terminalRef.current);
    term.write(args.command);

    return () => {
      term.dispose();
    };
  }, []);

  return <div ref={terminalRef} />;
});

export default RunCommand;
