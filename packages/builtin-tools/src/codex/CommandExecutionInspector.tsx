'use client';

import { SiGit, SiGooglechrome, SiNodedotjs, SiPython } from '@icons-pack/react-simple-icons';
import {
  createGrepContentInspector,
  createReadLocalFileInspector,
  RunCommandInspector,
} from '@lobechat/shared-tool-ui/inspectors';
import type { RunCommandState } from '@lobechat/tool-runtime';
import type { BuiltinInspectorProps } from '@lobechat/types';
import {
  Camera,
  CodeXml,
  Eye,
  Globe,
  Keyboard,
  MousePointerClick,
  ScanText,
  TextCursorInput,
  Timer,
} from 'lucide-react';
import type { ComponentType } from 'react';
import { memo } from 'react';

import {
  type AgentBrowserAction,
  type CodexCommandProgram,
  getAgentBrowserCommandDisplay,
  getCodexCommandProgram,
  getCodexGrepCommandDisplay,
  getCodexReadFileCommandDisplay,
} from './commandExecutionUtils';

const COMMAND_EXECUTION_KEY = 'builtins.codex.apiName.command_execution';
const GREP_KEY = 'builtins.codex.commandExecution.grep';
const GREP_NO_RESULTS_KEY = 'builtins.codex.commandExecution.noResults';
const READ_FILE_KEY = 'builtins.codex.commandExecution.readFile';

const AGENT_BROWSER_DISPLAY: Record<
  AgentBrowserAction,
  { icon: ComponentType<{ className?: string; size?: number }>; translationKey: string }
> = {
  click: { icon: MousePointerClick, translationKey: 'builtins.codex.agentBrowser.click' },
  eval: { icon: CodeXml, translationKey: 'builtins.codex.agentBrowser.eval' },
  fill: { icon: TextCursorInput, translationKey: 'builtins.codex.agentBrowser.fill' },
  focus: { icon: Eye, translationKey: 'builtins.codex.agentBrowser.focus' },
  get: { icon: ScanText, translationKey: 'builtins.codex.agentBrowser.get' },
  navigate: { icon: Globe, translationKey: 'builtins.codex.agentBrowser.navigate' },
  press: { icon: Keyboard, translationKey: 'builtins.codex.agentBrowser.press' },
  screenshot: { icon: Camera, translationKey: 'builtins.codex.agentBrowser.screenshot' },
  snapshot: { icon: ScanText, translationKey: 'builtins.codex.agentBrowser.snapshot' },
  type: { icon: TextCursorInput, translationKey: 'builtins.codex.agentBrowser.type' },
  wait: { icon: Timer, translationKey: 'builtins.codex.agentBrowser.wait' },
};

/** Dedicated label + brand icon per program family. */
const PROGRAM_DISPLAY: Record<
  CodexCommandProgram,
  { icon: ComponentType<{ className?: string; size?: number }>; translationKey: string }
> = {
  'agent-browser': {
    icon: SiGooglechrome,
    translationKey: 'builtins.codex.commandExecution.agentBrowser',
  },
  'git': { icon: SiGit, translationKey: 'builtins.codex.commandExecution.gitOperation' },
  'node': { icon: SiNodedotjs, translationKey: 'builtins.codex.commandExecution.runNode' },
  'python': { icon: SiPython, translationKey: 'builtins.codex.commandExecution.runPython' },
};
const SharedGrepInspector = createGrepContentInspector({
  noResultsKey: GREP_NO_RESULTS_KEY,
  translationKey: GREP_KEY,
});
const SharedReadInspector = createReadLocalFileInspector(READ_FILE_KEY);

interface CommandExecutionArgs {
  background?: boolean;
  command: string;
  description?: string;
  timeout?: number;
}

interface ReadFileArgs {
  endLine?: number;
  path?: string;
  startLine?: number;
}

interface GrepArgs {
  pattern?: string;
}

const mapCommandToReadArgs = (command?: string): ReadFileArgs | undefined => {
  const display = getCodexReadFileCommandDisplay(command);
  if (!display) return;

  return {
    endLine: display.endLine,
    path: display.filePath,
    startLine: display.startLine,
  };
};

const mapCommandToGrepArgs = (command?: string): GrepArgs | undefined => {
  const display = getCodexGrepCommandDisplay(command);
  if (!display) return;

  return { pattern: display.pattern };
};

const CommandExecutionInspector = memo<
  BuiltinInspectorProps<CommandExecutionArgs, RunCommandState>
>((props) => {
  const {
    apiName,
    args,
    identifier,
    isArgumentsStreaming,
    isLoading,
    partialArgs,
    result,
    toolCallId,
  } = props;

  const readArgs = mapCommandToReadArgs(args?.command);
  const partialReadArgs = mapCommandToReadArgs(partialArgs?.command);
  if (readArgs || partialReadArgs) {
    return (
      <SharedReadInspector
        apiName={apiName}
        args={readArgs || partialReadArgs || {}}
        identifier={identifier}
        isArgumentsStreaming={isArgumentsStreaming}
        isLoading={isLoading}
        partialArgs={partialReadArgs}
        result={result}
        toolCallId={toolCallId}
      />
    );
  }

  const grepArgs = mapCommandToGrepArgs(args?.command);
  const partialGrepArgs = mapCommandToGrepArgs(partialArgs?.command);
  if (grepArgs || partialGrepArgs) {
    return (
      <SharedGrepInspector
        apiName={apiName}
        args={grepArgs || partialGrepArgs || {}}
        identifier={identifier}
        isArgumentsStreaming={isArgumentsStreaming}
        isLoading={isLoading}
        partialArgs={partialGrepArgs}
        result={result}
        toolCallId={toolCallId}
      />
    );
  }

  const agentBrowserDisplay =
    getAgentBrowserCommandDisplay(args?.command) ??
    getAgentBrowserCommandDisplay(partialArgs?.command);
  if (agentBrowserDisplay) {
    const { icon, translationKey } = AGENT_BROWSER_DISPLAY[agentBrowserDisplay.action];
    const description =
      agentBrowserDisplay.action === 'eval' ? undefined : agentBrowserDisplay.value;
    return (
      <RunCommandInspector
        {...props}
        args={{ ...args, command: '', description }}
        icon={icon}
        partialArgs={undefined}
        translationKey={translationKey}
      />
    );
  }

  const program =
    getCodexCommandProgram(args?.command) ?? getCodexCommandProgram(partialArgs?.command);
  if (program) {
    const { icon, translationKey } = PROGRAM_DISPLAY[program];
    return <RunCommandInspector {...props} icon={icon} translationKey={translationKey} />;
  }

  return <RunCommandInspector {...props} translationKey={COMMAND_EXECUTION_KEY} />;
});

CommandExecutionInspector.displayName = 'CodexCommandExecutionInspector';

export default CommandExecutionInspector;
