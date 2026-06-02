import type { BuiltinStreaming } from '@lobechat/types';

import { PersonalPagesApiName } from '../../types';
import { CreatePageStreaming } from './CreatePage';

export const PersonalPagesStreamings: Record<string, BuiltinStreaming> = {
  [PersonalPagesApiName.createPage]: CreatePageStreaming as BuiltinStreaming,
};
