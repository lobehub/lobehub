'use client';

import {
  createEditLocalFileInspector,
  createGlobLocalFilesInspector,
  createGrepContentInspector,
  createRunCommandInspector,
} from '@lobechat/shared-tool-ui/inspectors';

import { ClaudeCodeApiName } from '../types';
import { ReadInspector } from './ReadInspector';
import { SkillInspector } from './SkillInspector';
import { TodoWriteInspector } from './TodoWriteInspector';
import { WriteInspector } from './WriteInspector';

// CC's own tool names (Bash / Edit / Glob / Grep / Read / Write) are already
// the intended human-facing label, so we feed them to the shared factories as
// the "translation key" and let react-i18next's missing-key fallback echo it
// back verbatim. Keeps this package out of the plugin locale file.
//
// Bash / Edit / Glob / Grep can use the shared factories directly — Edit
// already reads `file_path`, and Glob / Grep only need `pattern`. Read and
// Write need arg mapping, so they live in their own sibling files.
export const ClaudeCodeInspectors = {
  [ClaudeCodeApiName.Bash]: createRunCommandInspector(ClaudeCodeApiName.Bash),
  [ClaudeCodeApiName.Edit]: createEditLocalFileInspector(ClaudeCodeApiName.Edit),
  [ClaudeCodeApiName.Glob]: createGlobLocalFilesInspector(ClaudeCodeApiName.Glob),
  [ClaudeCodeApiName.Grep]: createGrepContentInspector({
    noResultsKey: 'No results',
    translationKey: ClaudeCodeApiName.Grep,
  }),
  [ClaudeCodeApiName.Read]: ReadInspector,
  [ClaudeCodeApiName.Skill]: SkillInspector,
  [ClaudeCodeApiName.TodoWrite]: TodoWriteInspector,
  [ClaudeCodeApiName.Write]: WriteInspector,
};
