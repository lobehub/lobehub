'use client';

import type { BuiltinRenderProps } from '@lobechat/types';
import { memo } from 'react';

import type { CreateDocumentArgs, CreateDocumentState } from '../../../types';
import DocumentCard from './DocumentCard';

export type CreateDocumentRenderProps = Pick<
  BuiltinRenderProps<CreateDocumentArgs, CreateDocumentState>,
  'args' | 'pluginState'
>;

const CreateDocument = memo<CreateDocumentRenderProps>(({ args, pluginState }) => {
  const title = args?.title;
  const content = args?.content;

  if (!title || !content) return null;

  return <DocumentCard content={content} documentId={pluginState?.documentId} title={title} />;
});

export default CreateDocument;
