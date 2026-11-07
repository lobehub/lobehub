'use client';

import { memo } from 'react';

import { ReferDocumentView } from '@/features/ChatInput/InputEditor/ReferDocument/ReferDocumentView';

import { type MarkdownElementProps } from '../type';

interface ReferDocumentNodeProps {
  id?: string;
  name?: string;
}

const Render = memo<MarkdownElementProps<ReferDocumentNodeProps>>(({ node }) => {
  const { name } = node?.properties || {};

  return <ReferDocumentView title={name} />;
});

Render.displayName = 'ReferDocumentRender';

export default Render;
