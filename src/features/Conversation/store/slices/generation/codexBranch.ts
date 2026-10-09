import type {
  ConversationContext,
  CreateMessageParams,
  CreateThreadParams,
  UIChatMessage,
  WorkingDirConfig,
} from '@lobechat/types';

import { resolveCodexForkTarget } from '@/store/chat/slices/agentRun/actions/dispatch/codexForkTarget';
import { markdownToTxt } from '@/utils/markdownToTxt';

type SourceMessage = Pick<
  UIChatMessage,
  | 'id'
  | 'role'
  | 'content'
  | 'metadata'
  | 'threadId'
  | 'editorData'
  | 'files'
  | 'fileList'
  | 'imageList'
  | 'audioList'
  | 'videoList'
>;

/**
 * Builds a child thread and optional user message without modifying source history.
 *
 * Use when:
 * - Branching a message with native Codex provenance.
 *
 * Expects:
 * - A saved topic and the selected message's native turn metadata.
 *
 * Returns:
 * - Child creation parameters with an immutable native origin. The child carries no resume
 *   session until its own first turn records one, so it can never resume the source thread.
 */
export const buildCodexBranchParams = ({
  context,
  source,
  workingDirectory,
  workingDirectoryConfig,
}: {
  context: ConversationContext;
  source: SourceMessage;
  workingDirectory?: string;
  workingDirectoryConfig?: WorkingDirConfig;
}): { threadParams: CreateThreadParams; messageParams?: CreateMessageParams } => {
  if (!context.topicId) throw new Error('Codex branches require a saved topic');
  const resend = source.role === 'user' ? { content: source.content } : undefined;
  const target = resolveCodexForkTarget([source], source.id, resend ? 'before' : 'after');
  const threadParams: CreateThreadParams = {
    agentId: context.agentId,
    groupId: context.groupId ?? undefined,
    parentThreadId: source.threadId ?? undefined,
    sourceMessageId: source.id,
    // Same rule as `createThreadWithMessage`, so assistant forks (created without a message)
    // are not left untitled in Subtopics.
    title: markdownToTxt(source.content ?? '').slice(0, 80),
    topicId: context.topicId,
    type: 'continuation',
    metadata: {
      codexForkTarget: target,
      sourceMessageExcluded: Boolean(resend),
      workingDirectory,
      workingDirectoryConfig,
    },
  };
  if (!resend) return { threadParams };

  const metadata = { ...source.metadata };
  delete metadata.activeBranchIndex;
  delete metadata.codexTurnId;
  delete metadata.heteroMessageId;
  delete metadata.heteroSessionId;
  delete metadata.operationId;
  const files = [
    ...new Set([
      ...(source.files ?? []),
      ...(source.fileList ?? []).map((file) => file.id),
      ...(source.imageList ?? []).map((file) => file.id),
      ...(source.audioList ?? []).map((file) => file.id),
      ...(source.videoList ?? []).map((file) => file.id),
    ]),
  ];
  return {
    threadParams,
    messageParams: {
      agentId: context.agentId,
      content: resend.content,
      editorData: source.editorData ?? undefined,
      files,
      metadata,
      role: 'user',
      topicId: context.topicId,
    },
  };
};
