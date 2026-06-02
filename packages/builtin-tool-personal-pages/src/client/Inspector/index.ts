import type { BuiltinInspector } from '@lobechat/types';

import { PersonalPagesApiName } from '../../types';
import { CreatePageInspector } from './CreatePage';
import { ListPagesInspector } from './ListPages';
import { ModifyNodesInspector } from './ModifyNodes';
import { ReadPageInspector } from './ReadPage';
import { ReplaceContentInspector } from './ReplaceContent';

export const PersonalPagesInspectors: Record<string, BuiltinInspector> = {
  [PersonalPagesApiName.createPage]: CreatePageInspector as BuiltinInspector,
  [PersonalPagesApiName.listPages]: ListPagesInspector as BuiltinInspector,
  [PersonalPagesApiName.modifyNodes]: ModifyNodesInspector as BuiltinInspector,
  [PersonalPagesApiName.readPage]: ReadPageInspector as BuiltinInspector,
  [PersonalPagesApiName.replaceContent]: ReplaceContentInspector as BuiltinInspector,
};
