import { type BuiltinRender } from '@lobechat/types';

import CreateDocumentRender from './CreateDocumentRender';

export const NotebookIdentifier = 'lobe-notebook';

export const NotebookApiName = {
  createDocument: 'createDocument',
} as const;

export const NotebookRenders: Record<string, BuiltinRender> = {
  [NotebookApiName.createDocument]: CreateDocumentRender as BuiltinRender,
};
