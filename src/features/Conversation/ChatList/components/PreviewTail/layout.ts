import { splitAssistantGroupFinalAnswer } from '@lobechat/conversation-flow';

import type { TopicPreview } from '@/services/message/topicPreview';

import { getScmEventSource } from '../../../Markdown/plugins/ScmEvent/parseScmEvent';
import {
  buildChainView,
  getChainDurationsMs,
} from '../../../Messages/AssistantGroup/components/groupChain';
import {
  countAssistantLlmCalls,
  hasRenderableFinalAnswer,
  shouldFoldProcess,
} from '../../../Messages/AssistantGroup/components/segments';
import { getAgentSender, getBotSender } from '../../../Messages/User/resolveSenderIdentity';

type PreviewMessage = TopicPreview['message'];

// The group block reads its text from the conversation store unless overridden,
// and the store holds no messages while the preview shows.
export const groupAnswerProps = (message: PreviewMessage) => ({
  assistantId: message.id,
  content: message.content,
  contentOverride: message.content,
  disableEditing: true,
  domId: `${message.id}__answer`,
  error: message.error ?? undefined,
  hasToolsOverride: false,
  id: message.id,
  imageList: message.imageList,
  metadata: message.metadata ?? undefined,
  reasoning: message.reasoning ?? undefined,
  tools: message.tools,
});

export const resolvePreviewLayout = ({
  editedFiles,
  goals,
  kind,
  message,
  workRootOperationId,
  works,
}: TopicPreview) => {
  const roundWorks = workRootOperationId ? works : [];
  const hasCards = editedFiles.length > 0 || goals.length > 0 || roundWorks.length > 0;

  return {
    cardsBelow:
      kind === 'group' && hasCards ? { editedFiles, goals, works: roundWorks } : undefined,
    showModelLine: kind === 'single',
    worksAfterActions:
      kind === 'single' && message.metadata?.work?.rootOperationId && works.length > 0
        ? works
        : undefined,
  };
};

// Mirrors the group's own fold decision, so the header the list draws above the
// answer is already there and the swap does not push the avatar row.
export const resolvePreviewProcess = ({ blocks, kind, message, timeline }: TopicPreview) => {
  if (kind !== 'group' || blocks.length === 0) return undefined;

  const finishTypes = new Map(
    timeline.flatMap((row) => (row.finishType ? [[row.id, row.finishType] as const] : [])),
  );
  const chain = {
    blocks: blocks.map((block) => {
      const finishType = finishTypes.get(block.id);
      if (block.metadata?.finishType != null || !finishType) return block;
      return { ...block, metadata: { ...block.metadata, finishType } };
    }),
    id: message.id,
  };
  const view = buildChainView(chain, { hasActiveOperation: false, isGenerating: false });
  const { finalSegments, processSegments } = splitAssistantGroupFinalAnswer(view.segments);
  const folds = shouldFoldProcess({
    enabled: true,
    hasFinalAnswer: hasRenderableFinalAnswer(finalSegments),
    isGenerating: false,
    isLatestItem: true,
    operationEnded: true,
    processSegments,
  });
  if (!folds) return undefined;

  return {
    durationMs: getChainDurationsMs(timeline, [chain])[0] ?? 0,
    stepCount: countAssistantLlmCalls(view.segments),
  };
};

// PreviewQuestion draws the viewer's own plain question; any other sender keeps
// the bottom-anchored preview, where the skeleton covers the rows above.
const isPlainQuestion = (message: PreviewMessage) =>
  message.role === 'user' &&
  !getBotSender(message) &&
  !getAgentSender(message) &&
  !message.metadata?.subAgentCallback &&
  !message.metadata?.steer &&
  !getScmEventSource(message.content);

export const resolveWholeTopicLeading = ({ leading }: TopicPreview) =>
  leading && leading.every(isPlainQuestion) ? leading : undefined;
