'use client';

import type { UIChatMessage } from '@lobechat/types';
import { Flexbox, Markdown } from '@lobehub/ui';
import isEqual from 'fast-deep-equal';
import { memo, type ReactNode } from 'react';

import {
  MetricsDisplay,
  type TaskMetrics,
  TaskStatusIndicator,
} from '@/features/Conversation/Messages/GroupTasks/TaskItem/TaskTitle';
import { isProcessingStatus, TaskContent } from '@/features/Conversation/Messages/Tasks/shared';
import { useConversationStore } from '@/features/Conversation/store';
import { useChatStore } from '@/store/chat';
import { threadSelectors } from '@/store/chat/selectors';

import { resolveMemberStatus, resolveMemberThreadId, selectMemberAnchors } from './memberAnchor';

/** Member anchors of a server-run multi-member call, keyed by task index. */
export const useMemberAnchors = (toolCallId?: string) =>
  useConversationStore((s) => selectMemberAnchors(s.dbMessages, toolCallId), isEqual);

/**
 * Live status of one member. While it runs, poll its isolation thread: the
 * anchor itself is only written when the member finishes. A finished member is
 * not polled — the status endpoint stamps a never-polled thread's duration at
 * request time, so a late fetch would show a wrong run time.
 */
const useMemberProgress = (anchor: UIChatMessage) => {
  const status = resolveMemberStatus(anchor);
  const sourceThreadId = useChatStore(
    (s) => threadSelectors.getIsolationThreadBySourceMsgId(anchor.id)(s)?.id,
  );
  const threadId = resolveMemberThreadId(anchor) ?? sourceThreadId;
  const useEnablePollingTaskStatus = useChatStore((s) => s.useEnablePollingTaskStatus);
  useEnablePollingTaskStatus(threadId, anchor.id, isProcessingStatus(status));

  return { status, threadId };
};

interface MemberTaskTitleProps {
  anchor?: UIChatMessage;
  children: ReactNode;
}

/** A task title with its member's status icon and run metrics once the member is running. */
export const MemberTaskTitle = memo<MemberTaskTitleProps>(({ anchor, children }) => {
  if (!anchor) return children;

  return <MemberTaskTitleWithProgress anchor={anchor}>{children}</MemberTaskTitleWithProgress>;
});

MemberTaskTitle.displayName = 'MemberTaskTitle';

const MemberTaskTitleWithProgress = memo<Required<MemberTaskTitleProps>>(({ anchor, children }) => {
  const { status } = useMemberProgress(anchor);
  const detail = anchor.taskDetail;
  const metrics: TaskMetrics = {
    duration: detail?.duration,
    llmCalls: detail?.totalSteps,
    startTime: detail?.startedAt ? new Date(detail.startedAt).getTime() : undefined,
    toolCalls: detail?.totalToolCalls,
  };

  return (
    <Flexbox horizontal align={'center'} gap={8} style={{ minWidth: 0 }}>
      <TaskStatusIndicator status={status} />
      {children}
      <MetricsDisplay metrics={metrics} status={status} />
    </Flexbox>
  );
});

MemberTaskTitleWithProgress.displayName = 'MemberTaskTitleWithProgress';

/**
 * What one member is doing or did. While it runs, show its live thread; once it
 * finishes, its anchor holds the final answer (or the failure reason). The
 * thread's own messages live in another bucket, so the conversation blocks
 * cannot render a finished thread's text here.
 */
export const MemberTaskDetail = memo<{ anchor: UIChatMessage }>(({ anchor }) => {
  const { status, threadId } = useMemberProgress(anchor);

  if (!isProcessingStatus(status) || !threadId) {
    return anchor.content ? <Markdown variant={'chat'}>{anchor.content}</Markdown> : null;
  }

  return (
    <TaskContent
      id={anchor.id}
      isError={false}
      messages={anchor.tasks}
      status={status}
      taskDetail={anchor.taskDetail}
      threadId={threadId}
    />
  );
});

MemberTaskDetail.displayName = 'MemberTaskDetail';
