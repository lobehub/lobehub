import { ArtboardApiName } from '@lobechat/builtin-tool-artboard';
import { registerBuiltinRenders } from '@lobechat/builtin-tools/renders';
import type { BuiltinRender } from '@lobechat/types';

import { registerDeliverableTool } from '@/features/Conversation/Messages/AssistantGroup/toolRenderRules';

import BoardCard from './BoardCard';
import { ARTBOARD_TOOL } from './tool';

let registered = false;

export const registerArtboardTool = () => {
  if (registered) return;
  registered = true;
  registerDeliverableTool(ARTBOARD_TOOL);
  registerBuiltinRenders({
    [ARTBOARD_TOOL]: {
      [ArtboardApiName.createArtboard]: BoardCard as BuiltinRender,
      [ArtboardApiName.updateArtboard]: BoardCard as BuiltinRender,
    },
  });
};
