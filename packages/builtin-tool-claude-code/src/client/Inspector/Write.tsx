'use client';

import { createWriteLocalFileInspector } from '@lobechat/shared-tool-ui/inspectors';
import type { BuiltinInspectorProps } from '@lobechat/types';
import { memo } from 'react';

import { ClaudeCodeApiName } from '../../types';

/**
 * CC Write tool uses `file_path`; the shared inspector reads `path`.
 */

interface CCWriteArgs {
  content?: string;
  file_path?: string;
}

interface SharedWriteArgs {
  content?: string;
  path?: string;
}

const mapArgs = (args?: CCWriteArgs): SharedWriteArgs => {
  const { content, file_path } = args ?? {};
  return { content, path: file_path };
};

const SharedInspector = createWriteLocalFileInspector(ClaudeCodeApiName.Write);

export const WriteInspector = memo<BuiltinInspectorProps<CCWriteArgs>>((props) => (
  <SharedInspector {...props} args={mapArgs(props.args)} partialArgs={mapArgs(props.partialArgs)} />
));
WriteInspector.displayName = 'ClaudeCodeWriteInspector';
