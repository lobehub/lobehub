import type { BuiltinToolManifest } from '@lobechat/types';
import { A2UI_TOOL_DESCRIPTION, A2UI_TOOL_META, A2UI_TOOL_PARAMETERS } from '@lobehub/a2ui/tool';

import { systemPrompt } from './systemRole';
import { A2uiApiName, A2uiIdentifier } from './types';

/** The card tool as `@lobehub/a2ui` defines it. */
export const A2uiManifest: BuiltinToolManifest = {
  api: [
    {
      description: A2UI_TOOL_DESCRIPTION,
      name: A2uiApiName.renderUI,
      parameters: A2UI_TOOL_PARAMETERS,
    },
  ],
  identifier: A2uiIdentifier,
  meta: { ...A2UI_TOOL_META },
  systemRole: systemPrompt,
  type: 'builtin',
};
