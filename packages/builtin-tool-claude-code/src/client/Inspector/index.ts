'use client';

import {
  createGlobLocalFilesInspector,
  createGrepContentInspector,
  createRunCommandInspector,
} from '@lobechat/shared-tool-ui/inspectors';
import type { BuiltinInspector } from '@lobechat/types';

import { ClaudeCodeApiName } from '../../types';
import { AgentInspector } from './Agent';
import { AskUserQuestionInspector } from './AskUserQuestion';
import { EditInspector } from './Edit';
import { LinearMcpInspectors } from './LinearMcp';
import { MonitorInspector } from './Monitor';
import { ReadInspector } from './Read';
import { ScheduleWakeupInspector } from './ScheduleWakeup';
import { SendMessageInspector } from './SendMessage';
import { SkillInspector } from './Skill';
import { TaskInspector } from './Task';
import { TaskGetInspector } from './TaskGet';
import { TaskOutputInspector } from './TaskOutput';
import { TaskStopInspector } from './TaskStop';
import { TodoWriteInspector } from './TodoWrite';
import { ToolSearchInspector } from './ToolSearch';
import { WebFetchInspector } from './WebFetch';
import { WebSearchInspector } from './WebSearch';
import { EnterWorktreeInspector, ExitWorktreeInspector } from './Worktree';
import { WriteInspector } from './Write';

// CC's own tool names (Bash / Edit / Glob / Grep / Read / Write) are already
// the intended human-facing label, so we feed them to the shared factories as
// the "translation key" and let react-i18next's missing-key fallback echo it
// back verbatim. Keeps this package out of the plugin locale file.
//
// Bash / Glob / Grep can use the shared factories directly — Glob / Grep only
// need `pattern`. Edit / Read / Write need arg mapping (or synthesized plugin
// state for diff stats), so they live in their own sibling files.
const FixedClaudeCodeInspectors = {
  [ClaudeCodeApiName.Agent]: AgentInspector,
  [ClaudeCodeApiName.AskUserQuestion]: AskUserQuestionInspector,
  [ClaudeCodeApiName.Bash]: createRunCommandInspector(ClaudeCodeApiName.Bash),
  [ClaudeCodeApiName.Edit]: EditInspector,
  [ClaudeCodeApiName.EnterWorktree]: EnterWorktreeInspector,
  [ClaudeCodeApiName.ExitWorktree]: ExitWorktreeInspector,
  [ClaudeCodeApiName.Glob]: createGlobLocalFilesInspector(ClaudeCodeApiName.Glob),
  [ClaudeCodeApiName.Grep]: createGrepContentInspector({
    noResultsKey: 'No results',
    translationKey: ClaudeCodeApiName.Grep,
  }),
  // Monitor is a long-running tracked tool — its turns drive a SignalCallbacks
  // accordion below the AssistantGroup (). The dedicated inspector
  // uses the lucide `Monitor` (screen) icon to match the tool name.
  [ClaudeCodeApiName.Monitor]: MonitorInspector,
  [ClaudeCodeApiName.Read]: ReadInspector,
  [ClaudeCodeApiName.ScheduleWakeup]: ScheduleWakeupInspector,
  [ClaudeCodeApiName.SendMessage]: SendMessageInspector,
  [ClaudeCodeApiName.Skill]: SkillInspector,
  // CC 2.1.143+ task tools — TaskCreate / TaskUpdate / TaskList share the
  // same inspector because they're driven by the adapter-synthesized
  // `pluginState.todos` snapshot (the per-call args are deltas, not state).
  // TaskGet is read-only with no pluginState, so it gets its own minimal chip.
  [ClaudeCodeApiName.TaskCreate]: TaskInspector,
  [ClaudeCodeApiName.TaskGet]: TaskGetInspector,
  [ClaudeCodeApiName.TaskList]: TaskInspector,
  [ClaudeCodeApiName.TaskOutput]: TaskOutputInspector,
  [ClaudeCodeApiName.TaskStop]: TaskStopInspector,
  [ClaudeCodeApiName.TaskUpdate]: TaskInspector,
  [ClaudeCodeApiName.TodoWrite]: TodoWriteInspector,
  [ClaudeCodeApiName.ToolSearch]: ToolSearchInspector,
  [ClaudeCodeApiName.WebFetch]: WebFetchInspector,
  [ClaudeCodeApiName.WebSearch]: WebSearchInspector,
  [ClaudeCodeApiName.Write]: WriteInspector,
  ...LinearMcpInspectors,
};

export const ClaudeCodeInspectors = new Proxy(FixedClaudeCodeInspectors, {
  get: (target, prop) => {
    if (typeof prop !== 'string') return undefined;
    return prop in target ? target[prop as keyof typeof target] : LinearMcpInspectors[prop];
  },
}) as unknown as Record<string, BuiltinInspector>;
