'use client';

import { useQueryState } from '@/hooks/useQueryParam';
import { useImageStore } from '@/store/image';

import Content from './Content';
import EmptyState from './EmptyState';

const ImageWorkspace = () => {
  const [topic] = useQueryState('topic');
  const isCreatingWithNewTopic = useImageStore((s) => s.isCreatingWithNewTopic);

  // 如果没有 topic 参数，或者正在创建新 topic 的图片，显示空状态布局
  if (!topic || isCreatingWithNewTopic) {
    return <EmptyState />;
  }

  // 有 topic 参数且不在创建新 topic 状态时显示主要内容
  return <Content />;
};

export default ImageWorkspace;
