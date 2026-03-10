import type { BuiltinInspector } from '@lobechat/types';

import { DocumentApiName } from '../../types';
import { EditTitleInspector } from './EditTitle';
import { GetPageContentInspector } from './GetPageContent';
import { InitPageInspector } from './InitPage';
import { ModifyNodesInspector } from './ModifyNodes';
import { ReplaceTextInspector } from './ReplaceText';

/**
 * Page Agent Inspector Components Registry
 *
 * Inspector components customize the title/header area
 * of tool calls in the conversation UI.
 */
export const PageAgentInspectors: Record<string, BuiltinInspector> = {
  [DocumentApiName.editTitle]: EditTitleInspector as BuiltinInspector,
  [DocumentApiName.getPageContent]: GetPageContentInspector as BuiltinInspector,
  [DocumentApiName.initPage]: InitPageInspector as BuiltinInspector,
  [DocumentApiName.modifyNodes]: ModifyNodesInspector as BuiltinInspector,
  [DocumentApiName.replaceText]: ReplaceTextInspector as BuiltinInspector,
};
