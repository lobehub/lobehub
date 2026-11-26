import type { BuiltinToolManifest } from '@lobechat/types';
import { getA2uiProcessor } from '@lobehub/a2ui';

import { systemPrompt } from './systemRole';
import { A2uiApiName, A2uiIdentifier } from './types';

const { tool } = getA2uiProcessor();

/** The card tool as `@lobehub/a2ui` defines it. */
export const A2uiManifest: BuiltinToolManifest = {
  api: [{ description: tool.description, name: A2uiApiName.renderUI, parameters: tool.parameters }],
  identifier: A2uiIdentifier,
  meta: { ...tool.meta },
  systemRole: systemPrompt,
  type: 'builtin',
};
