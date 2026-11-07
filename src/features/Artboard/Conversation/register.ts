import { ArtboardApiName } from '@lobechat/builtin-tool-artboard';
import { registerBuiltinPortals } from '@lobechat/builtin-tools/portals';
import { registerBuiltinRenders } from '@lobechat/builtin-tools/renders';
import type { BuiltinPortal, BuiltinPortalTitle, BuiltinRender } from '@lobechat/types';

import { registerDeliverableTool } from '@/features/Conversation/Messages/AssistantGroup/toolRenderRules';

import BoardCard from './BoardCard';
import BoardPortal, { BoardPortalTitle } from './BoardPortal';
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
  registerBuiltinPortals({
    portals: { [ARTBOARD_TOOL]: BoardPortal as BuiltinPortal },
    titles: { [ARTBOARD_TOOL]: BoardPortalTitle as BuiltinPortalTitle },
  });
};
