import type { BuiltinToolManifest } from '@lobechat/types';

import { NativeUIParameters } from './native/schema';
import { systemPrompt } from './systemRole';
import { InteractiveUIApiName, InteractiveUIIdentifier } from './types';

export const InteractiveUIManifest: BuiltinToolManifest = {
  api: [
    {
      description:
        'Create a native interactive answer using host components, shared scalar state, and bounded pure expressions. Controls and charts update locally without a model call. No HTML, CSS, JavaScript, network access, or arbitrary host actions.',
      name: InteractiveUIApiName.renderUI,
      parameters: NativeUIParameters,
      renderDisplayControl: 'alwaysExpand',
    },
  ],
  identifier: InteractiveUIIdentifier,
  meta: {
    avatar: '🎛️',
    description:
      'Explore interactive calculators, comparisons, and visual explanations inside chat.',
    title: 'Interactive UI',
  },
  systemRole: systemPrompt,
  type: 'builtin',
};
