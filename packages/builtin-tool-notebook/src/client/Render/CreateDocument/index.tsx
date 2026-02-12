'use client';

import type { BuiltinRenderProps } from '@lobechat/types';
import { memo } from 'react';

import type { CreateDocumentArgs, CreateDocumentState } from '../../../types';
import DocumentCard from './DocumentCard';

export type CreateDocumentRenderProps = Pick<
  BuiltinRenderProps<CreateDocumentArgs, CreateDocumentState>,
  'pluginState'
>;

const CreateDocument = memo<CreateDocumentRenderProps>(({ pluginState }) => {
  const { document } = pluginState || {};

  if (!document) {
    return null;
  }

  return <DocumentCard document={document} />;
});

export default CreateDocument;
