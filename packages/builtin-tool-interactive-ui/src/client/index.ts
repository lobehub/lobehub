import type { BuiltinInspector, BuiltinRender, BuiltinStreaming } from '@lobechat/types';

import { InteractiveUIApiName } from '../types';
import { InteractiveUIInspector } from './Inspector';
import { RenderUI } from './Render';
import { StreamingUI } from './Streaming';

export { InteractiveUIManifest } from '../manifest';
export const InteractiveUIInspectors = {
  [InteractiveUIApiName.renderUI]: InteractiveUIInspector as BuiltinInspector,
};
export const InteractiveUIRenders = { [InteractiveUIApiName.renderUI]: RenderUI as BuiltinRender };
export const InteractiveUIStreamings = {
  [InteractiveUIApiName.renderUI]: StreamingUI as BuiltinStreaming,
};
