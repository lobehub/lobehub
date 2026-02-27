import { ToolsActivatorApiName } from '../../types';
import { ActivateToolsInspector } from './ActivateTools';

export const LobeToolsInspectors = {
  [ToolsActivatorApiName.activateTools]: ActivateToolsInspector,
};
