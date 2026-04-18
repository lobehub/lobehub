'use client';

import { createReadLocalFileInspector } from '@lobechat/shared-tool-ui/inspectors';
import type { BuiltinInspectorProps } from '@lobechat/types';
import { memo } from 'react';

import { ClaudeCodeApiName } from '../../types';

/**
 * CC Read tool uses Anthropic-native args (`file_path`, `offset`, `limit`);
 * the shared inspector reads `path` / `startLine` / `endLine`. Map between
 * them so shared stays untouched.
 */

interface CCReadArgs {
  file_path?: string;
  limit?: number;
  offset?: number;
}

interface SharedReadArgs {
  endLine?: number;
  path?: string;
  startLine?: number;
}

const mapArgs = (args?: CCReadArgs): SharedReadArgs => {
  const { file_path, offset, limit } = args ?? {};
  const endLine = offset !== undefined && limit !== undefined ? offset + limit : undefined;
  return { endLine, path: file_path, startLine: offset };
};

const SharedInspector = createReadLocalFileInspector(ClaudeCodeApiName.Read);

export const ReadInspector = memo<BuiltinInspectorProps<CCReadArgs>>((props) => (
  <SharedInspector {...props} args={mapArgs(props.args)} partialArgs={mapArgs(props.partialArgs)} />
));
ReadInspector.displayName = 'ClaudeCodeReadInspector';
