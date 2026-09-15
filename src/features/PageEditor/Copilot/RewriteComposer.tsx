'use client';

import type { CapturedCollaborativeRewriteSelection } from '@lobehub/editor';
import { ChatInput as EditorChatInput, ChatInputActionBar } from '@lobehub/editor/react';
import { Flexbox, TextArea } from '@lobehub/ui';
import { Button, Text } from '@lobehub/ui/base-ui';
import type { TextAreaRef } from 'antd/es/input/TextArea';
import { ArrowLeftIcon, CheckIcon, SendIcon, XIcon } from 'lucide-react';
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { ActionBarContext } from '@/features/ChatInput/ActionBar/context';
import {
  COMPACT_ACTION_BAR_CONTEXT,
  COMPACT_ACTION_BAR_STYLE,
} from '@/features/ChatInput/compactPreset';
import AgentSelectorAction from '@/features/PageEditor/Copilot/AgentSelector/AgentSelectorAction';
import CopilotModelSelect from '@/features/PageEditor/Copilot/CopilotModelSelect';
import { usePageEditorStore } from '@/features/PageEditor/store';
import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import { useAgentStore } from '@/store/agent';
import { agentByIdSelectors } from '@/store/agent/selectors';
import { aiProviderSelectors, useAiInfraStore } from '@/store/aiInfra';

import {
  getDefaultImageModel,
  isBlockImagePlaceholderSelection,
  isBlockImageRewriteSelection,
  isEnabledImageModel,
} from './imageRewrite';
import { styles } from './rewrite.styles';
import {
  getPageRewriteErrorMessage,
  getRewriteQuotedText,
  isPageRewriteActiveLimitError,
  isPageRewriteContinuationChangedError,
  isPageRewriteContinuationDeletedError,
  isPageRewriteTargetConflictError,
  PAGE_REWRITE_MAX_ACTIVE_REQUESTS,
  type PageRewriteRequest,
  pageRewriteRequestClient,
} from './rewriteRequests';
import RewriteSessionChat from './RewriteSessionChat';

interface RewriteComposerProps {
  activeRequestCount?: number;
  continuationParent?: PageRewriteRequest | null;
  /** Stable identity for an explicit rewrite/continuation open action. */
  focusKey?: string | number;
  /** Current node state; selection metadata may be stripped after persistence. */
  imagePlaceholder?: boolean;
  onBack?: () => void;
  onClose: () => void;
  onRemovePlaceholder?: () => void;
  onSubmitted?: () => void | Promise<void>;
  selection: CapturedCollaborativeRewriteSelection;
  sessionRequests?: readonly PageRewriteRequest[];
}

export const getRewriteComposerResetKey = (
  selection: CapturedCollaborativeRewriteSelection,
  continuationParentId: string | null,
): string =>
  [
    continuationParentId ?? '',
    selection.kind,
    'roomId' in selection ? selection.roomId : '',
    selection.startNodeId,
    selection.startOffset,
    selection.endNodeId,
    selection.endOffset,
    selection.quotedTextHash,
    selection.quotedText,
    'capturedAt' in selection ? selection.capturedAt : '',
  ]
    .map((value) => String(value ?? ''))
    .join('\u0000');

const RewriteComposer = memo<RewriteComposerProps>(
  ({
    activeRequestCount = 0,
    continuationParent = null,
    focusKey,
    imagePlaceholder,
    onBack,
    onClose,
    onRemovePlaceholder,
    onSubmitted,
    selection,
    sessionRequests = [],
  }) => {
    const { t } = useTranslation(['editor', 'chat']);
    const navigate = useWorkspaceAwareNavigate();
    const documentId = usePageEditorStore((s) => s.documentId);
    const activeAgentId = useAgentStore((s) => s.activeAgentId);
    const activeAgentIsHeterogeneous = useAgentStore((s) =>
      activeAgentId ? agentByIdSelectors.isAgentHeterogeneousById(activeAgentId)(s) : false,
    );
    const pageAgentId = useAgentStore((s) => s.builtinAgentIdMap['page-agent']);
    const setActiveAgentId = useAgentStore((s) => s.setActiveAgentId);
    const enabledImageModelList = useAiInfraStore(aiProviderSelectors.enabledImageModelList);
    const isImageRewrite = isBlockImageRewriteSelection(selection);
    const isImagePlaceholder =
      isBlockImageRewriteSelection(selection) &&
      (imagePlaceholder ?? isBlockImagePlaceholderSelection(selection));
    const defaultImageModel = useMemo(
      () => getDefaultImageModel(enabledImageModelList),
      [enabledImageModelList],
    );
    const [agentId, setAgentId] = useState(
      activeAgentId && !activeAgentIsHeterogeneous ? activeAgentId : pageAgentId || '',
    );
    const agentModel = useAgentStore((s) =>
      agentId ? agentByIdSelectors.getAgentModelById(agentId)(s) : undefined,
    );
    const agentProvider = useAgentStore((s) =>
      agentId ? agentByIdSelectors.getAgentModelProviderById(agentId)(s) : undefined,
    );
    const [instruction, setInstruction] = useState('');
    const [error, setError] = useState<string>();
    const [submitting, setSubmitting] = useState(false);
    const continuationParentId = continuationParent?.id ?? null;
    const firstSessionRequest = [...sessionRequests].sort(
      (left, right) =>
        (left.turnIndex ?? 1) - (right.turnIndex ?? 1) ||
        left.createdAt.localeCompare(right.createdAt) ||
        left.id.localeCompare(right.id),
    )[0];
    const continuationContextText = continuationParent
      ? getRewriteQuotedText(firstSessionRequest ?? continuationParent) || selection.quotedText
      : selection.quotedText;
    const displaySelection =
      continuationParent && continuationContextText !== selection.quotedText
        ? { ...selection, quotedText: continuationContextText }
        : selection;
    const resetKey = getRewriteComposerResetKey(displaySelection, continuationParentId);
    const instructionInputRef = useRef<TextAreaRef>(null);
    const focusIdentity = focusKey ?? resetKey;
    const previousResetKeyRef = useRef(resetKey);
    const activeLimitReached = activeRequestCount >= PAGE_REWRITE_MAX_ACTIVE_REQUESTS;
    const selectionCharacterCount = Array.from(displaySelection.quotedText).length;
    const previousTurn = useMemo(() => {
      const turns = [
        ...sessionRequests,
        ...(continuationParent ? [continuationParent] : []),
      ].filter(Boolean);
      return turns.sort(
        (left, right) =>
          (right.turnIndex ?? 1) - (left.turnIndex ?? 1) ||
          right.updatedAt.localeCompare(left.updatedAt),
      )[0];
    }, [continuationParent, sessionRequests]);
    const defaultModel = previousTurn?.requestedModel || previousTurn?.model || agentModel;
    const defaultProvider =
      previousTurn?.requestedProvider || previousTurn?.provider || agentProvider;
    const previousImageModel = isImageRewrite
      ? (() => {
          const previousModel = previousTurn?.requestedModel || previousTurn?.model;
          const previousProvider = previousTurn?.requestedProvider || previousTurn?.provider;
          if (typeof previousModel !== 'string' || typeof previousProvider !== 'string') {
            return undefined;
          }
          const candidate = { model: previousModel, provider: previousProvider };
          return isEnabledImageModel(enabledImageModelList, candidate) ? candidate : undefined;
        })()
      : undefined;
    const effectiveDefaultModel = isImageRewrite
      ? previousImageModel?.model || defaultImageModel?.model
      : defaultModel;
    const effectiveDefaultProvider = isImageRewrite
      ? previousImageModel?.provider || defaultImageModel?.provider
      : defaultProvider;
    const [model, setModel] = useState(effectiveDefaultModel);
    const [provider, setProvider] = useState(effectiveDefaultProvider);
    const latestSessionRequest = [...sessionRequests].sort(
      (left, right) =>
        (right.turnIndex ?? 1) - (left.turnIndex ?? 1) ||
        right.updatedAt.localeCompare(left.updatedAt),
    )[0];
    const imagePlaceholderNeedsCleanup =
      isImagePlaceholder &&
      Boolean(
        latestSessionRequest &&
        ['canceled', 'canceled_after_write', 'failed', 'rejected', 'stale'].includes(
          latestSessionRequest.status,
        ),
      );

    useLayoutEffect(() => {
      const frame = window.requestAnimationFrame(() => {
        instructionInputRef.current?.focus({ preventScroll: true });
      });

      return () => window.cancelAnimationFrame(frame);
    }, [focusIdentity]);

    useEffect(() => {
      if (!isImageRewrite) return;
      if (model && provider && isEnabledImageModel(enabledImageModelList, { model, provider }))
        return;
      setModel(defaultImageModel?.model);
      setProvider(defaultImageModel?.provider);
    }, [defaultImageModel, enabledImageModelList, isImageRewrite, model, provider]);

    useEffect(() => {
      if (agentId) return;
      const fallbackAgentId =
        activeAgentId && !activeAgentIsHeterogeneous ? activeAgentId : pageAgentId;
      if (fallbackAgentId) setAgentId(fallbackAgentId);
    }, [activeAgentId, activeAgentIsHeterogeneous, agentId, pageAgentId]);

    useEffect(() => {
      if (previousResetKeyRef.current === resetKey) return;
      previousResetKeyRef.current = resetKey;
      const nextAgentId =
        activeAgentId && !activeAgentIsHeterogeneous ? activeAgentId : pageAgentId || '';
      setAgentId(nextAgentId);
      setInstruction('');
      setError(undefined);
      setModel(effectiveDefaultModel);
      setProvider(effectiveDefaultProvider);
    }, [
      activeAgentId,
      activeAgentIsHeterogeneous,
      effectiveDefaultModel,
      effectiveDefaultProvider,
      pageAgentId,
      resetKey,
    ]);

    const handleAgentChange = useCallback(
      (nextAgentId: string) => {
        setAgentId(nextAgentId);
        setActiveAgentId(nextAgentId);
      },
      [setActiveAgentId],
    );

    const submit = async () => {
      const trimmedInstruction = instruction.trim();
      if (!documentId || (!continuationParent && !agentId) || !trimmedInstruction) return;
      if (isImageRewrite && (!model || !provider)) {
        setError(t('copilot.rewrite.imageModelRequired'));
        return;
      }
      if (activeLimitReached) {
        setError(t('copilot.rewrite.activeLimit'));
        return;
      }

      setSubmitting(true);
      setError(undefined);
      try {
        if (continuationParent) {
          await pageRewriteRequestClient.continue({
            instruction: trimmedInstruction,
            model: model ?? null,
            parentRequestId: continuationParent.id,
            provider: provider ?? null,
          });
        } else {
          await pageRewriteRequestClient.create({
            agentId,
            documentId,
            instruction: trimmedInstruction,
            model: model ?? null,
            selection,
            provider: provider ?? null,
          });
        }
        setInstruction('');
        await onSubmitted?.();
      } catch (cause) {
        if (isPageRewriteContinuationDeletedError(cause)) {
          setError(t('copilot.rewrite.continuationDeleted'));
        } else if (isPageRewriteContinuationChangedError(cause)) {
          setError(t('copilot.rewrite.continuationChanged'));
        } else if (isPageRewriteActiveLimitError(cause)) {
          setError(t('copilot.rewrite.activeLimit'));
        } else if (isPageRewriteTargetConflictError(cause)) {
          setError(t('copilot.rewrite.overlapError'));
        } else {
          setError(getPageRewriteErrorMessage(cause, t('copilot.rewrite.createError')));
        }
      } finally {
        setSubmitting(false);
      }
    };

    const sessionContextId =
      continuationParent?.sessionId ||
      continuationParent?.id ||
      selection.quotedTextHash ||
      selection.startNodeId;
    const isContinuation = Boolean(continuationParent);

    return (
      <div data-page-rewrite-composer className={styles.composer}>
        <div className={styles.header}>
          <Flexbox horizontal align="center" gap={4}>
            {isContinuation && (
              <Button
                aria-label={t('copilot.rewrite.back', { defaultValue: 'Back to Agent edits' })}
                icon={<ArrowLeftIcon size={15} />}
                size="small"
                type="text"
                onClick={onBack || onClose}
              />
            )}
            <Text strong>
              {isImageRewrite
                ? t('copilot.rewrite.imageTitle')
                : isContinuation
                  ? t('copilot.rewrite.continueTitle', { defaultValue: 'Continue modifying' })
                  : t('copilot.rewrite.title')}
            </Text>
          </Flexbox>
          <Button
            aria-label={t('cancel')}
            icon={<XIcon size={15} />}
            size="small"
            type="text"
            onClick={onClose}
          />
        </div>
        <Flexbox
          horizontal
          align="center"
          className={styles.selectionStatus}
          data-page-rewrite-selection-count={selectionCharacterCount}
          data-page-rewrite-selection-status="selected"
          gap={6}
          role="status"
        >
          <CheckIcon aria-hidden="true" size={14} />
          <Text strong>
            {isImageRewrite
              ? t('copilot.rewrite.imageSelectionStatus', {
                  defaultValue: 'Image target selected',
                })
              : isContinuation
                ? t('copilot.rewrite.continueStatus', { defaultValue: 'Continuing this session' })
                : t('copilot.rewrite.selectionStatus', { count: selectionCharacterCount })}
          </Text>
        </Flexbox>
        <RewriteSessionChat
          initialContext={{ id: sessionContextId, text: displaySelection.quotedText }}
          requests={sessionRequests}
          topicId={previousTurn?.topicId}
        />
        {error && (
          <Flexbox horizontal align="center" justify="space-between" role="alert">
            <Text className={styles.error}>{error}</Text>
            {isImagePlaceholder && onRemovePlaceholder && (
              <Button size="small" type="text" onClick={onRemovePlaceholder}>
                {t('copilot.rewrite.removePlaceholder')}
              </Button>
            )}
          </Flexbox>
        )}
        {activeLimitReached && (
          <Text data-page-rewrite-active-limit className={styles.activeLimit} role="alert">
            {t('copilot.rewrite.activeLimit')}
          </Text>
        )}
        {isImageRewrite && !defaultImageModel && (
          <Flexbox
            horizontal
            align="center"
            className={styles.imageNotice}
            justify="space-between"
            role="alert"
          >
            <Text className={styles.activeLimit}>{t('copilot.rewrite.imageModelUnavailable')}</Text>
            <Button size="small" type="text" onClick={() => navigate('/settings/provider/all')}>
              {t('copilot.rewrite.configureImageModel')}
            </Button>
          </Flexbox>
        )}
        {imagePlaceholderNeedsCleanup && !error && onRemovePlaceholder && (
          <Flexbox horizontal justify="flex-end">
            <Button size="small" type="text" onClick={onRemovePlaceholder}>
              {t('copilot.rewrite.removePlaceholder')}
            </Button>
          </Flexbox>
        )}
        <EditorChatInput
          className={styles.input}
          data-testid="page-rewrite-continuation-input"
          defaultHeight={36}
          maxHeight={240}
          minHeight={36}
          resize={false}
          showResizeHandle={false}
          style={{ flex: 'none', height: 'auto' }}
          styles={{ body: { padding: 8 } }}
          footer={
            <ChatInputActionBar
              style={COMPACT_ACTION_BAR_STYLE}
              left={
                isContinuation ? (
                  <Text className={styles.inputHint} type="secondary">
                    {t('copilot.rewrite.continueStatus')}
                  </Text>
                ) : (
                  <ActionBarContext value={COMPACT_ACTION_BAR_CONTEXT}>
                    <Flexbox horizontal align="center" gap={2}>
                      <AgentSelectorAction onAgentChange={handleAgentChange} />
                    </Flexbox>
                  </ActionBarContext>
                )
              }
              right={
                <Flexbox horizontal align="center" gap={4}>
                  <CopilotModelSelect
                    disabled={submitting}
                    mode={isImageRewrite ? 'image' : 'chat'}
                    model={model}
                    provider={provider}
                    onModelChange={({ model: nextModel, provider: nextProvider }) => {
                      setModel(nextModel);
                      setProvider(nextProvider);
                    }}
                  />
                  <Button
                    icon={<SendIcon size={15} />}
                    loading={submitting}
                    size="small"
                    type="primary"
                    disabled={
                      submitting ||
                      activeLimitReached ||
                      !instruction.trim() ||
                      !documentId ||
                      (isImageRewrite && (!model || !provider)) ||
                      (!isContinuation && !agentId)
                    }
                    onClick={() => void submit()}
                  >
                    {isContinuation
                      ? t('copilot.rewrite.continue', { defaultValue: 'Continue' })
                      : t('copilot.rewrite.submit')}
                  </Button>
                </Flexbox>
              }
            />
          }
        >
          <TextArea
            autoSize={{ maxRows: 8, minRows: 1 }}
            disabled={submitting}
            maxLength={32_768}
            ref={instructionInputRef}
            resize={false}
            value={instruction}
            variant="borderless"
            placeholder={
              isImageRewrite
                ? t('copilot.rewrite.imageInstructionPlaceholder')
                : t('copilot.rewrite.instructionPlaceholder')
            }
            onChange={(event) => {
              setInstruction(event.target.value);
              setError(undefined);
            }}
            onPressEnter={(event) => {
              if (event.shiftKey || event.nativeEvent.isComposing) return;
              event.preventDefault();
              void submit();
            }}
          />
        </EditorChatInput>
      </div>
    );
  },
);

RewriteComposer.displayName = 'RewriteComposer';

export default RewriteComposer;
