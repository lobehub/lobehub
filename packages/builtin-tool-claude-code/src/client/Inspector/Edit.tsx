'use client';

import { createEditLocalFileInspector } from '@lobechat/shared-tool-ui/inspectors';
import type { BuiltinInspectorProps } from '@lobechat/types';
import { memo, useMemo } from 'react';

import { ClaudeCodeApiName } from '../../types';

interface CCEditArgs {
  file_path?: string;
  new_string?: string;
  old_string?: string;
  replace_all?: boolean;
}

// Mirrors `EditFileState` from `@lobechat/tool-runtime` — duplicated locally to
// keep this package free of a tool-runtime dep (it only reads the two line
// counts; the shared inspector accepts the shape via `any`).
interface SynthesizedEditState {
  linesAdded: number;
  linesDeleted: number;
  path: string;
  replacements: number;
}

/**
 * LCS-based line-diff counter. Compares two snippets line-by-line and returns
 * the number of added / deleted lines — matches what `CodeDiff` shows in the
 * render header. Cheap enough for Edit payloads (typically a handful of lines).
 */
const countLineDiff = (oldText: string, newText: string) => {
  if (oldText === newText) return { linesAdded: 0, linesDeleted: 0 };
  if (!oldText) return { linesAdded: newText.split('\n').length, linesDeleted: 0 };
  if (!newText) return { linesAdded: 0, linesDeleted: oldText.split('\n').length };

  const oldLines = oldText.split('\n');
  const newLines = newText.split('\n');
  const m = oldLines.length;
  const n = newLines.length;

  const prev = Array.from<number>({ length: n + 1 }).fill(0);
  const curr = Array.from<number>({ length: n + 1 }).fill(0);

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      curr[j] =
        oldLines[i - 1] === newLines[j - 1] ? prev[j - 1] + 1 : Math.max(prev[j], curr[j - 1]);
    }
    for (let j = 0; j <= n; j++) prev[j] = curr[j];
  }

  const unchanged = prev[n];
  return { linesAdded: n - unchanged, linesDeleted: m - unchanged };
};

const SharedInspector = createEditLocalFileInspector(ClaudeCodeApiName.Edit);

/**
 * CC Edit runs remotely via Anthropic tool_use blocks, so there's no local
 * runtime producing `EditFileState`. Synthesize `linesAdded` / `linesDeleted`
 * from the args' `old_string` / `new_string` so the collapsed header carries
 * change magnitude alongside the file path.
 */
export const EditInspector = memo<BuiltinInspectorProps<CCEditArgs, SynthesizedEditState>>(
  ({ args, pluginState, ...rest }) => {
    const synthesized = useMemo<SynthesizedEditState | undefined>(() => {
      if (pluginState) return pluginState;
      if (!args?.old_string && !args?.new_string) return undefined;

      const { linesAdded, linesDeleted } = countLineDiff(
        args.old_string ?? '',
        args.new_string ?? '',
      );

      return {
        linesAdded,
        linesDeleted,
        path: args.file_path ?? '',
        replacements: args.replace_all ? 0 : 1,
      };
    }, [args, pluginState]);

    return <SharedInspector {...rest} args={args} pluginState={synthesized} />;
  },
);
EditInspector.displayName = 'ClaudeCodeEditInspector';
