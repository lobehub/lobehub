'use client';

import {
  createGlobLocalFilesInspector,
  createGrepContentInspector,
  createRunCommandInspector,
} from '@lobechat/shared-tool-ui/inspectors';

import { ClaudeCodeApiName } from '../../types';
import { AgentInspector } from './Agent';
import { EditInspector } from './Edit';
import { ReadInspector } from './Read';
import { ScheduleWakeupInspector } from './ScheduleWakeup';
import { SkillInspector } from './Skill';
import { TaskOutputInspector } from './TaskOutput';
import { TaskStopInspector } from './TaskStop';
import { TodoWriteInspector } from './TodoWrite';
import { ToolSearchInspector } from './ToolSearch';
import { WriteInspector } from './Write';

// CC's own tool names (Bash / Edit / Glob / Grep / Read / Write) are already
// the intended human-facing label, so we feed them to the shared factories as
// the "translation key" and let react-i18next's missing-key fallback echo it
// back verbatim. Keeps this package out of the plugin locale file.
//
// Bash / Glob / Grep can use the shared factories directly — Glob / Grep only
// need `pattern`. Edit / Read / Write need arg mapping (or synthesized plugin
// state for diff stats), so they live in their own sibling files.
export const ClaudeCodeInspectors = {
  [ClaudeCodeApiName.Agent]: AgentInspector,
  [ClaudeCodeApiName.Bash]: createRunCommandInspector(ClaudeCodeApiName.Bash),
  [ClaudeCodeApiName.Edit]: EditInspector,
  [ClaudeCodeApiName.Glob]: createGlobLocalFilesInspector(ClaudeCodeApiName.Glob),
  [ClaudeCodeApiName.Grep]: createGrepContentInspector({
    noResultsKey: 'No results',
    translationKey: ClaudeCodeApiName.Grep,
  }),
  [ClaudeCodeApiName.Read]: ReadInspector,
  [ClaudeCodeApiName.ScheduleWakeup]: ScheduleWakeupInspector,
  [ClaudeCodeApiName.Skill]: SkillInspector,
  [ClaudeCodeApiName.TaskOutput]: TaskOutputInspector,
  [ClaudeCodeApiName.TaskStop]: TaskStopInspector,
  [ClaudeCodeApiName.TodoWrite]: TodoWriteInspector,
  [ClaudeCodeApiName.ToolSearch]: ToolSearchInspector,
  [ClaudeCodeApiName.Write]: WriteInspector,
};
