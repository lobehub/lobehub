'use client';

import { memo } from 'react';

import { ReferTopicView } from '@/features/ChatInput/InputEditor/ReferTopic/ReferTopicView';

import { type MarkdownElementProps } from '../type';

interface ReferTopicNodeProps {
  id?: string;
  name?: string;
}

const Render = memo<MarkdownElementProps<ReferTopicNodeProps>>(({ node }) => {
  const { id, name } = node?.properties || {};

  if (!id) return name || null;

  return <ReferTopicView fallbackTitle={name} topicId={id} />;
});

Render.displayName = 'ReferTopicRender';

export default Render;
