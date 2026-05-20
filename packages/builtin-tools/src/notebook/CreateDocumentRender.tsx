'use client';

import type { BuiltinRenderProps } from '@lobechat/types';
import { memo } from 'react';

import DocumentCard from './DocumentCard';
import type { CreateDocumentArgs, CreateDocumentState } from './types';

const CreateDocumentRender = memo<BuiltinRenderProps<CreateDocumentArgs, CreateDocumentState>>(
  ({ pluginState }) => {
    const { document } = pluginState || {};

    if (!document) return null;

    return <DocumentCard document={document} />;
  },
);

CreateDocumentRender.displayName = 'NotebookCreateDocumentRender';

export default CreateDocumentRender;
