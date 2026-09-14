'use client';

import { DEFAULT_AVATAR } from '@lobechat/const';
import { agentDisplayName, type UIChatMessage } from '@lobechat/types';
import { Flexbox } from '@lobehub/ui';
import { Button, Text } from '@lobehub/ui/base-ui';
import { ChatList, type ChatMessage } from '@lobehub/ui/chat';
import { createStaticStyles, cssVar } from 'antd-style';
import {
  AlertCircleIcon,
  CheckCircle2Icon,
  ChevronDownIcon,
  ChevronUpIcon,
  LoaderCircleIcon,
} from 'lucide-react';
import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import useSWR, { useSWRConfig } from 'swr';

import NeuralNetworkLoading from '@/components/NeuralNetworkLoading';
import { ChatItem as ConversationChatItem } from '@/features/Conversation/ChatItem';
import { messageService } from '@/services/message';
import { useAgentStore } from '@/store/agent';
import { agentByIdSelectors } from '@/store/agent/selectors';

import { usePageRewriteComposer } from '../rewriteComposerContext';
import { canRetryRewriteFailure, getRewriteFailureKey } from './rewriteFailure';
import type {
  PageRewriteProgress,
  PageRewriteProgressEvent,
  PageRewriteRequest,
  PageRewriteStatus,
} from './rewriteRequests';
import {
  getRewriteQuotedText,
  isPageRewriteActiveStatus,
  normalizePageRewriteProgress,
  pageRewriteRequestClient,
} from './rewriteRequests';

const styles = createStaticStyles(({ css }) => ({
  messageExtra: css`
    font-size: ${cssVar.fontSizeSM};
    color: ${cssVar.colorTextTertiary};
  `,
  messageError: css`
    font-size: ${cssVar.fontSizeSM};
    line-height: ${cssVar.lineHeightSM};
    color: ${cssVar.colorError};
  `,
  progress: css`
    margin-block-end: 4px;
    border-radius: ${cssVar.borderRadiusSM};
    background: ${cssVar.colorFillQuaternary};
  `,
  progressBody: css`
    display: flex;
    flex-direction: column;
    gap: 4px;

    padding-block: 4px 6px;
    padding-inline: 8px;
  `,
  progressEvent: css`
    display: flex;
    gap: 6px;
    align-items: baseline;

    min-width: 0;

    font-size: 11px;
    line-height: 1.35;
    color: ${cssVar.colorTextSecondary};
  `,
  progressEventIcon: css`
    flex: 0 0 auto;
    color: ${cssVar.colorTextTertiary};
  `,
  progressHeader: css`
    cursor: pointer;

    min-width: 0;
    padding-block: 4px;
    padding-inline: 8px;

    list-style: none;

    &::-webkit-details-marker {
      display: none;
    }
  `,
  progressSummary: css`
    margin-block-start: 4px;
    padding-block-start: 4px;
    border-block-start: 1px solid ${cssVar.colorBorderSecondary};

    font-size: 11px;
    line-height: 1.4;
    color: ${cssVar.colorTextSecondary};
  `,
  fullOutputToggle: css`
    margin-block-start: 2px;
    padding-inline: 0;
    font-size: 11px;
  `,
  contextMessage: css`
    padding-block: 4px;
    padding-inline: 8px;
    border-radius: ${cssVar.borderRadiusSM};

    color: ${cssVar.colorTextSecondary};

    background: ${cssVar.colorFillQuaternary};
  `,
  scroll: css`
    overflow: auto;
    display: flex;
    flex: 1 1 auto;
    flex-direction: column;

    width: 100%;
    min-width: 0;
    min-height: 0;
  `,
}));

type RewriteMessageKind = 'context' | 'instruction' | 'output';

const LONG_REPLY_MAX_PREVIEW_LENGTH = 280;
const LONG_REPLY_THRESHOLD = 1_200;
const CODE_LIKE_REPLY = /```|<\/?(?:!doctype|html|main|body|div|section|style|script)\b/iu;

const stageLabel = (
  stage: PageRewriteProgressEvent['stage'],
  translate: (key: string, options: { defaultValue: string }) => string,
): string =>
  translate(`copilot.rewrite.progress.${stage.replaceAll('_', '-')}`, {
    defaultValue: stage.replaceAll('_', ' '),
  });

const toolLabel = (
  tool: string | undefined,
  translate: (key: string, options: { defaultValue: string }) => string,
): string | undefined => {
  if (!tool) return undefined;
  const labels: Record<string, string> = {
    read_document_block: 'document block',
    read_document_range: 'document range',
    read_document_structure: 'document structure',
    search_document_text: 'document text',
  };
  const fallback = labels[tool];
  return fallback
    ? translate(`copilot.rewrite.progress.tool.${tool.replaceAll('_', '-')}`, {
        defaultValue: fallback,
      })
    : undefined;
};

interface RewriteMessageExtra {
  agentId?: string | null;
  errorCode?: string | null;
  errorMessage?: string | null;
  kind: RewriteMessageKind;
  nodeTarget?: boolean;
  progress?: PageRewriteProgress | null;
  request?: PageRewriteRequest;
  retryAllowed?: boolean;
  status?: PageRewriteStatus;
}

export type RewriteSessionChatMessage = ChatMessage & {
  extra?: RewriteMessageExtra;
};

const toTimestamp = (value: string): number => {
  const timestamp = Date.parse(value);
  return Number.isNaN(timestamp) ? Date.now() : timestamp;
};

const compareRequests = (left: PageRewriteRequest, right: PageRewriteRequest): number =>
  (left.turnIndex ?? 1) - (right.turnIndex ?? 1) ||
  left.createdAt.localeCompare(right.createdAt) ||
  left.id.localeCompare(right.id);

interface RewriteSessionContext {
  id: string;
  text: string;
}

const getRewriteSessionContextText = (
  requests: readonly PageRewriteRequest[],
  initialContext?: RewriteSessionContext,
): string => {
  if (initialContext?.text) return initialContext.text;
  const first = [...requests].sort(compareRequests)[0];
  return first ? getRewriteQuotedText(first) : '';
};

/**
 * Convert the durable rewrite session into the same alternating user/assistant
 * message shape that the topic chat presentation consumes. This is a pure
 * adapter: it does not read or write ConversationStore/topic state.
 */
export const toRewriteSessionMessages = (
  requests: readonly PageRewriteRequest[],
  initialContext?: RewriteSessionContext,
): RewriteSessionChatMessage[] => {
  const ordered = [...requests].sort(compareRequests);
  const first = ordered[0];
  if (!first && !initialContext) return [];

  // `initialContext` is the session's original selection. Never substitute a
  // request's outputText here: outputs belong to the assistant history rows.
  const originalText = getRewriteSessionContextText(ordered, initialContext);
  const contextId = first?.sessionId || first?.id || initialContext?.id;
  if (!contextId) return [];
  const contextTimestamp = first ? toTimestamp(first.createdAt) : Date.now();
  const opening: RewriteSessionChatMessage = {
    content: originalText,
    createAt: contextTimestamp,
    extra: { kind: 'context' },
    id: `rewrite-context-${contextId}`,
    meta: {},
    role: 'assistant',
    updateAt: contextTimestamp,
  };

  if (!first) return [opening];

  return [
    opening,
    ...ordered.flatMap((request) => {
      const timestamp = toTimestamp(request.createdAt);
      const outputText =
        typeof request.outputText === 'string' && request.outputText.length > 0
          ? request.outputText
          : '';
      const instruction: RewriteSessionChatMessage = {
        content: request.instruction,
        createAt: timestamp,
        extra: { kind: 'instruction' },
        id: `rewrite-instruction-${request.id}`,
        meta: { title: 'You' },
        role: 'user',
        updateAt: timestamp,
      };
      const output: RewriteSessionChatMessage = {
        content: outputText,
        createAt: timestamp,
        extra: {
          agentId: request.agentId,
          errorCode: request.errorCode,
          errorMessage: request.errorMessage,
          kind: 'output',
          progress: request.progress,
          status: request.status,
          request,
          retryAllowed: canRetryRewriteFailure(request) && request === ordered.at(-1),
        },
        id: `rewrite-output-${request.id}`,
        meta: {},
        role: 'assistant',
        updateAt: toTimestamp(request.updatedAt),
      };
      return [instruction, output];
    }),
  ];
};

/**
 * Adapt the durable rewrite topic transcript to the same ChatList item shape
 * used by ordinary conversations. Tool rows stay out of the bubble stream:
 * their bounded public stage is already projected onto the rewrite request.
 */
export const toTopicRewriteMessages = (
  topicMessages: readonly UIChatMessage[],
  requests: readonly PageRewriteRequest[],
  initialContext?: RewriteSessionContext,
): RewriteSessionChatMessage[] => {
  const requestById = new Map(requests.map((request) => [request.id, request]));
  const latestRequest = [...requests].sort(compareRequests).at(-1);
  const projected = topicMessages
    .filter((message) => message.role === 'user' || message.role === 'assistant')
    .map((message) => {
      const metadata = message.metadata as
        (Record<string, unknown> & { requestId?: unknown }) | null | undefined;
      const requestId = typeof metadata?.requestId === 'string' ? metadata.requestId : undefined;
      const request = requestId ? requestById.get(requestId) : undefined;
      const isUser = message.role === 'user';
      const createdAt = Number.isFinite(message.createdAt) ? message.createdAt : Date.now();
      const updatedAt = Number.isFinite(message.updatedAt) ? message.updatedAt : createdAt;
      return {
        ...message,
        // The durable user row contains an internal envelope so the server
        // can give MessagesEngine the complete adapter-owned source. It is
        // not chat copy: always project the human instruction back to the
        // bubble. Assistant output remains the model's normal topic content.
        content:
          isUser && request
            ? request.instruction
            : request && message.content === '...' && !request.outputText
              ? ''
              : message.content || '',
        createAt: createdAt,
        extra: {
          agentId: request?.agentId || message.agentId,
          kind: isUser ? 'instruction' : 'output',
          ...(!isUser
            ? {
                errorCode: request?.errorCode,
                errorMessage: request?.errorMessage,
                progress: request?.progress,
                status: request?.status,
                request,
                retryAllowed:
                  request && canRetryRewriteFailure(request) && request === latestRequest,
              }
            : {}),
        },
        id: message.id,
        meta: {},
        role: message.role,
        updateAt: updatedAt,
      } as RewriteSessionChatMessage;
    });

  const orderedRequests = [...requests].sort(compareRequests);
  const firstRequest = orderedRequests[0];
  // Keep the opening context immutable across continuation turns. The latest
  // request's output is projected only as its assistant message below.
  const contextText = getRewriteSessionContextText(orderedRequests, initialContext);
  const contextId = initialContext?.id || firstRequest?.sessionId || firstRequest?.id;
  if (!contextText || !contextId) return projected;
  const timestamp = initialContext ? Date.now() : toTimestamp(firstRequest!.createdAt);
  const context: RewriteSessionChatMessage = {
    content: contextText,
    createAt: timestamp,
    extra: { kind: 'context' },
    id: `rewrite-context-${contextId}`,
    meta: {},
    role: 'assistant',
    updateAt: timestamp,
  };
  return [context, ...projected];
};

const RewriteProgressView = memo<{
  progress?: PageRewriteProgress | null;
  status?: PageRewriteStatus;
}>(({ progress, status }) => {
  const { t } = useTranslation('editor');
  const safeProgress = useMemo(() => normalizePageRewriteProgress(progress), [progress]);
  const active = Boolean(status && isPageRewriteActiveStatus(status));
  const [expanded, setExpanded] = useState(active);

  useEffect(() => {
    if (active) setExpanded(true);
  }, [active]);

  if (!safeProgress || (safeProgress.events.length === 0 && !safeProgress.summary)) return null;

  const latest = safeProgress.events.at(-1);
  const latestLabel =
    status && !active
      ? t(`copilot.rewrite.status.${status.replaceAll('_', '-')}`, { defaultValue: status })
      : status === 'retry_wait'
        ? t('copilot.rewrite.status.retry-wait')
        : latest
          ? `${stageLabel(latest.stage, t)}${toolLabel(latest.tool, t) ? ` · ${toolLabel(latest.tool, t)}` : ''}`
          : stageLabel(safeProgress.currentStage, t);
  const StatusIcon =
    status === 'failed' || status === 'stale'
      ? AlertCircleIcon
      : active
        ? LoaderCircleIcon
        : CheckCircle2Icon;

  return (
    <details
      data-rewrite-progress
      className={styles.progress}
      open={expanded}
      onToggle={(event) => setExpanded(event.currentTarget.open)}
    >
      <summary className={styles.progressHeader}>
        <Flexbox horizontal align="center" gap={6}>
          {active ? (
            <NeuralNetworkLoading size={16} />
          ) : (
            <StatusIcon aria-hidden="true" size={13} />
          )}
          <Text ellipsis type="secondary">
            {latestLabel}
          </Text>
          {expanded ? (
            <ChevronUpIcon aria-hidden="true" size={12} />
          ) : (
            <ChevronDownIcon aria-hidden="true" size={12} />
          )}
        </Flexbox>
      </summary>
      <div className={styles.progressBody}>
        {safeProgress.events.map((event, index) => (
          <div
            className={styles.progressEvent}
            data-rewrite-progress-stage={event.stage}
            key={`${event.at}-${event.stage}-${index}`}
          >
            <span className={styles.progressEventIcon}>
              {index === safeProgress.events.length - 1 && active ? '◦' : '·'}
            </span>
            <Text ellipsis type="secondary">
              {stageLabel(event.stage, t)}
              {toolLabel(event.tool, t) ? ` · ${toolLabel(event.tool, t)}` : ''}
            </Text>
          </div>
        ))}
        {safeProgress.summary && (
          <Text className={styles.progressSummary}>{safeProgress.summary}</Text>
        )}
      </div>
    </details>
  );
});

RewriteProgressView.displayName = 'RewriteProgressView';

const RewriteFailure = ({ extra }: { extra: RewriteMessageExtra }) => {
  const { t } = useTranslation('editor');
  const { mutate } = useSWRConfig();
  const { setDraftHighlightVisible } = usePageRewriteComposer();
  const [retrying, setRetrying] = useState(false);
  const [retryError, setRetryError] = useState(false);
  const request = extra.request;
  return (
    <Flexbox data-rewrite-failure gap={8}>
      <Text className={styles.messageError} role="alert">
        {t(getRewriteFailureKey(extra.errorCode), {
          defaultValue: 'The rewrite failed. Review the selection before trying again.',
        })}
      </Text>
      {extra.retryAllowed && request && (
        <Button
          disabled={retrying}
          size="small"
          onClick={async () => {
            if (retrying) return;
            setDraftHighlightVisible(false);
            setRetrying(true);
            setRetryError(false);
            try {
              await pageRewriteRequestClient.retry({ id: request.id, attempt: request.attempt });
              await mutate(['page-rewrite-requests', request.documentId]);
            } catch {
              setRetryError(true);
            } finally {
              setRetrying(false);
            }
          }}
        >
          {t(retrying ? 'copilot.rewrite.status.retry-wait' : 'copilot.rewrite.retry')}
        </Button>
      )}
      {retryError && (
        <Text className={styles.messageError} role="alert">
          {t('copilot.rewrite.actionError')}
        </Text>
      )}
      {extra.errorCode && (
        <details>
          <summary>{t('copilot.rewrite.showDetails')}</summary>
          <Text as="div" className={styles.messageExtra}>
            {extra.errorCode}
          </Text>
          {extra.progress?.events.at(-1)?.detail && (
            <Text as="div" className={styles.messageExtra}>
              {extra.progress.events.at(-1)?.detail}
            </Text>
          )}
        </details>
      )}
    </Flexbox>
  );
};

export const RewriteSessionMessage = memo<RewriteSessionChatMessage & { loading?: boolean }>(
  ({ content, createAt, extra, id, loading, role, updateAt }) => {
    const { t } = useTranslation(['editor', 'chat']);
    const isUser = role === 'user';
    const isContext = extra?.kind === 'context';
    const agentId = extra?.agentId || '';
    const agent = useAgentStore((state) =>
      agentId ? agentByIdSelectors.getAgentById(agentId)(state) : undefined,
    );
    const isBuiltinAgent = useAgentStore((state) =>
      agentId ? Object.values(state.builtinAgentIdMap).includes(agentId) : false,
    );
    const fallbackTitle = isBuiltinAgent
      ? t('builtinCopilot', { defaultValue: 'Page Copilot', ns: 'chat' })
      : t('copilot.rewrite.agent', { defaultValue: 'Agent' });
    const avatar = useMemo(
      () => ({
        avatar: agent?.avatar || DEFAULT_AVATAR,
        backgroundColor: agent?.backgroundColor || undefined,
        name: agent?.name || undefined,
        title: agent?.title || agentDisplayName(agent, fallbackTitle),
      }),
      [agent, fallbackTitle],
    );
    const statusLabel = extra?.status
      ? t(`copilot.rewrite.status.${extra.status.replaceAll('_', '-')}`, {
          defaultValue: extra.status,
        })
      : null;
    const isError = !isUser && (extra?.status === 'failed' || extra?.status === 'stale');
    const active = extra?.status ? isPageRewriteActiveStatus(extra.status) : Boolean(loading);
    const statusText = !isUser && !isError ? statusLabel : null;
    const [showFullOutput, setShowFullOutput] = useState(false);
    const canCollapseOutput =
      !isUser &&
      !isContext &&
      content.length > LONG_REPLY_THRESHOLD &&
      CODE_LIKE_REPLY.test(content);
    const outputMessage =
      canCollapseOutput && !showFullOutput
        ? `${Array.from(content).slice(0, LONG_REPLY_MAX_PREVIEW_LENGTH).join('').trimEnd()}…`
        : content;
    return (
      <div
        data-rewrite-chat-message={extra?.kind}
        data-rewrite-chat-message-id={id}
        data-testid="page-rewrite-session-message"
      >
        {!isUser && !isContext && (
          <RewriteProgressView progress={extra?.progress} status={extra?.status} />
        )}
        <ConversationChatItem
          avatar={avatar}
          className={isContext ? styles.contextMessage : undefined}
          id={undefined}
          loading={!isUser && active}
          message={outputMessage || ' '}
          placement={isUser ? 'right' : 'left'}
          showAvatar={!isUser && !isContext}
          showTitle={!isUser && !isContext}
          time={isContext ? undefined : updateAt || createAt}
          messageExtra={
            isError && extra ? (
              <RewriteFailure extra={extra} />
            ) : statusText ? (
              <Text className={isError ? styles.messageError : styles.messageExtra}>
                {statusText}
              </Text>
            ) : undefined
          }
        />
        {canCollapseOutput && (
          <Button
            className={styles.fullOutputToggle}
            size="small"
            type="text"
            onClick={() => setShowFullOutput((current) => !current)}
          >
            {showFullOutput
              ? t('copilot.rewrite.hideFullOutput', { defaultValue: 'Collapse full output' })
              : t('copilot.rewrite.showFullOutput', { defaultValue: 'Show full output' })}
          </Button>
        )}
      </div>
    );
  },
);

RewriteSessionMessage.displayName = 'RewriteSessionMessage';

export const RewriteSessionChat = memo<{
  initialContext?: RewriteSessionContext;
  requests: readonly PageRewriteRequest[];
  topicId?: string | null;
}>(({ initialContext, requests, topicId }) => {
  const { t } = useTranslation('editor');
  const { data: topicMessages } = useSWR<UIChatMessage[]>(
    topicId ? ['page-rewrite-topic-messages', topicId] : null,
    () => messageService.getMessages({ topicId }),
    {
      dedupingInterval: 500,
      refreshInterval: 2_000,
      refreshWhenHidden: false,
      refreshWhenOffline: false,
      shouldRetryOnError: false,
    },
  );
  const messages = useMemo(() => {
    if (topicId && topicMessages) {
      const topicProjection = toTopicRewriteMessages(topicMessages, requests, initialContext);
      if (topicProjection.length > 0) return topicProjection;
    }
    return toRewriteSessionMessages(requests, initialContext);
  }, [initialContext, requests, topicId, topicMessages]);
  const lastMessageContent = messages.at(-1)?.content;
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const node = scrollRef.current;
    if (!node) return;
    node.scrollTop = node.scrollHeight;
  }, [lastMessageContent, messages]);

  if (messages.length === 0) return null;

  return (
    <div
      data-page-rewrite-session-chat
      aria-label={t('copilot.rewrite.history')}
      className={styles.scroll}
      data-testid="page-rewrite-session-chat"
      ref={scrollRef}
    >
      <ChatList
        showAvatar
        showTitle
        data={messages}
        renderItems={{ default: RewriteSessionMessage }}
        variant="bubble"
      />
    </div>
  );
});

RewriteSessionChat.displayName = 'RewriteSessionChat';

export default RewriteSessionChat;
