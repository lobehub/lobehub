'use client';

import { Flexbox } from '@lobehub/ui';
import type { ReactNode } from 'react';
import { memo, useLayoutEffect, useRef } from 'react';

import { delayed } from '@/components/Skeleton/Delayed';
import type { TopicPreview } from '@/services/message/topicPreview';

import WideScreenContainer from '../../../../WideScreenContainer';
import { ChatItem } from '../../../ChatItem';
import SkeletonList from '../../../components/SkeletonList';
import { useAgentMeta } from '../../../hooks';
import MessageContent from '../../../Messages/Assistant/components/MessageContent';
import { AssistantMessageExtra } from '../../../Messages/Assistant/Extra';
import ContentBlock from '../../../Messages/AssistantGroup/components/ContentBlock';
import ProcessFold from '../../../Messages/AssistantGroup/components/ProcessFold';
import { formatReasoningDuration } from '../../../Messages/AssistantGroup/toolDisplayNames';
import EditedFilesCard from '../../../Messages/EditedFilesCard';
import GoalTaskCard from '../../../Messages/GoalTaskCard';
import { MessageWorkList } from '../../../Messages/MessageWorks';
import {
  groupAnswerProps,
  resolvePreviewLayout,
  resolvePreviewProcess,
  resolveWholeTopicLeading,
} from './layout';
import PreviewQuestion from './PreviewQuestion';

interface PreviewTailProps {
  headerSlot?: ReactNode;
  overlayHeight: number;
  preview: TopicPreview;
}

const PreviewAnswer = memo<{ preview: TopicPreview }>(({ preview }) => {
  const { message } = preview;
  const avatar = useAgentMeta(message.agentId);
  const { cardsBelow, showModelLine, worksAfterActions } = resolvePreviewLayout(preview);
  const process = resolvePreviewProcess(preview);

  return (
    <ChatItem
      showTitle
      actions={<div style={{ height: '28px' }} />}
      afterActions={worksAfterActions && <MessageWorkList items={worksAfterActions} />}
      avatar={avatar}
      placement={'left'}
      time={message.createdAt}
      belowMessage={
        cardsBelow && (
          <Flexbox gap={8}>
            {cardsBelow.editedFiles.length > 0 && (
              <EditedFilesCard entries={cardsBelow.editedFiles} />
            )}
            {cardsBelow.goals.length > 0 && <GoalTaskCard goals={cardsBelow.goals} />}
            {cardsBelow.works.length > 0 && <MessageWorkList items={cardsBelow.works} />}
          </Flexbox>
        )
      }
      messageExtra={
        showModelLine ? (
          <AssistantMessageExtra
            content={message.content}
            extra={message.extra}
            id={message.id}
            model={message.model ?? undefined}
            performance={(message.performance || message.metadata) ?? undefined}
            provider={message.provider ?? undefined}
            tools={message.tools}
            usage={(message.usage || message.metadata) ?? undefined}
          />
        ) : undefined
      }
    >
      {preview.kind === 'group' ? (
        <Flexbox gap={4}>
          {process && (
            <ProcessFold
              stepCount={process.stepCount}
              durationText={
                process.durationMs >= 1000 ? formatReasoningDuration(process.durationMs) : undefined
              }
            >
              {null}
            </ProcessFold>
          )}
          <ContentBlock {...groupAnswerProps(message)} />
        </Flexbox>
      ) : (
        <MessageContent {...message} />
      )}
    </ChatItem>
  );
});

PreviewAnswer.displayName = 'PreviewAnswer';

// Paints the final answer where the real list will put it, so the swap only adds rows above.
const PreviewTail = memo<PreviewTailProps>(({ headerSlot, overlayHeight, preview }) => {
  const paddingBottom = Math.max(24, overlayHeight + 12);
  const leading = resolveWholeTopicLeading(preview);
  const viewportRef = useRef<HTMLDivElement>(null);

  // A whole topic flows from the top like the list; once it overflows, the list
  // opens on its bottom, so the preview pins there too.
  useLayoutEffect(() => {
    const viewport = viewportRef.current;
    if (!leading || !viewport) return;
    const pin = () => {
      viewport.scrollTop = viewport.scrollHeight;
    };
    pin();
    const observer = new ResizeObserver(pin);
    for (const child of viewport.children) observer.observe(child);
    return () => observer.disconnect();
  }, [leading]);

  if (leading) {
    return (
      <div ref={viewportRef} style={{ height: '100%', minHeight: 0, overflow: 'hidden' }}>
        {headerSlot && <WideScreenContainer>{headerSlot}</WideScreenContainer>}
        {leading.map((message) => (
          <WideScreenContainer key={message.id} style={{ position: 'relative' }}>
            <PreviewQuestion message={message} />
          </WideScreenContainer>
        ))}
        <WideScreenContainer style={{ position: 'relative' }}>
          <PreviewAnswer preview={preview} />
        </WideScreenContainer>
        <div style={{ height: paddingBottom }} />
      </div>
    );
  }

  return (
    <Flexbox
      height={'100%'}
      justify={'flex-end'}
      style={{ minHeight: 0, overflow: 'hidden', paddingBottom }}
    >
      {headerSlot && <WideScreenContainer>{headerSlot}</WideScreenContainer>}
      <Flexbox flex={'none'}>{delayed(<SkeletonList />)}</Flexbox>
      <WideScreenContainer style={{ position: 'relative' }}>
        <PreviewAnswer preview={preview} />
      </WideScreenContainer>
    </Flexbox>
  );
});

PreviewTail.displayName = 'PreviewTail';

export default PreviewTail;
