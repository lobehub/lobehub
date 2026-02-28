'use client';

import { useQueryState } from '@/hooks/useQueryParam';
import { useVideoStore } from '@/store/video';

import Content from './Content';
import EmptyState from './EmptyState';

const VideoWorkspace = () => {
  const [topic] = useQueryState('topic');
  const isCreatingWithNewTopic = useVideoStore((s) => s.isCreatingWithNewTopic);

  if (!topic || isCreatingWithNewTopic) {
    return <EmptyState />;
  }

  return <Content />;
};

export default VideoWorkspace;
