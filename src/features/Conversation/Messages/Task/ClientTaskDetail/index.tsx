'use client';

import { type TaskDetail } from '@lobechat/types';
import { memo } from 'react';

import StatusContent from './StatusContent';

interface ClientTaskDetailProps {
  content?: string;
  instruction?: string;
  messageId: string;
  taskDetail?: TaskDetail;
}

const ClientTaskDetail = memo<ClientTaskDetailProps>(({ taskDetail, content, messageId }) => {
  return <StatusContent content={content} messageId={messageId} taskDetail={taskDetail} />;
});

ClientTaskDetail.displayName = 'ClientTaskDetail';

export default ClientTaskDetail;
