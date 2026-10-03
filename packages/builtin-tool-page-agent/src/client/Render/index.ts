import type { BuiltinRender } from '@lobechat/types';

import { DocumentApiName } from '../../types';
import ModifyNodesRender from './ModifyNodes';

/**
 * Page Agent Render Components Registry
 *
 * Render components customize how tool results are displayed to users.
 */
export const PageAgentRenders: Record<string, BuiltinRender | null> = {
  [DocumentApiName.initPage]: null,
  [DocumentApiName.modifyNodes]: ModifyNodesRender as BuiltinRender,
};
