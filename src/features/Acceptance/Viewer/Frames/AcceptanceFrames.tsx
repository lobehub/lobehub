'use client';

import { Button, Empty, Flexbox, Icon, Tag, Text } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { Info, MapPin } from 'lucide-react';
import { Fragment, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useAcceptanceScope } from '../AcceptanceScope';
import { useAcceptanceComments } from '../Comments/hooks';
import { layoutFrameTransitions, summarizeFrameBoard } from './frameBoard';
import FrameColumn from './FrameColumn';
import FrameDetail from './FrameDetail';
import SourceBadge from './SourceBadge';
import TransitionArrow from './TransitionArrow';
import { useFrameBoard } from './useFrameBoard';

const styles = stylex.create({
  strip: {
    overflowX: 'auto',
    paddingBlock: 4,
    paddingInline: 2,
  },
  legend: {
    backgroundColor: cssVar.colorFillQuaternary,
    borderRadius: 8,
    paddingBlock: 8,
    paddingInline: 12,
  },
  title: {
    fontSize: 16,
    fontWeight: 600,
  },
});

/**
 * The frames board: every node of one task laid out left to right with the
 * events that move between them, its candidate Canvas references stacked in
 * place.
 * Structured on purpose — a free canvas is where reviewers get lost — and in
 * two phases that never merge: the review locks a baseline per node, the
 * delivery check pins real captures beside it.
 */
export const AcceptanceFrames = () => {
  const { t } = useTranslation('verify');
  const { acceptanceId } = useAcceptanceScope();
  const { board, isLoading, update } = useFrameBoard(acceptanceId);
  const comments = useAcceptanceComments(acceptanceId);
  const [activeId, setActiveId] = useState<string>();
  const [previewIds, setPreviewIds] = useState<Record<string, string>>({});
  const [pinMode, setPinMode] = useState(false);

  const frameThreads = useMemo(
    () => comments.threads.filter(({ root }) => root.anchorType === 'frame'),
    [comments.threads],
  );

  if (!board) return isLoading ? null : <Empty description={t('frames.empty')} />;

  const summary = summarizeFrameBoard(board);
  const { between, others } = layoutFrameTransitions(board);
  const active = board.frames.find((frame) => frame.id === activeId) ?? board.frames[0];
  const threadsOf = (frameId: string) =>
    frameThreads.filter(({ root }) => root.frame?.frameId === frameId);
  const titleOf = (frameId: string) =>
    board.frames.find((frame) => frame.id === frameId)?.title ?? frameId;

  return (
    <Flexbox gap={16}>
      <Flexbox horizontal align={'flex-start'} gap={16} justify={'space-between'} wrap={'wrap'}>
        <Flexbox gap={6} style={{ minWidth: 0 }}>
          <span {...stylex.props(styles.title)}>{board.title}</span>
          {board.description && <Text type={'secondary'}>{board.description}</Text>}
          <Flexbox horizontal gap={8} wrap={'wrap'}>
            <Tag color={summary.baselined === summary.total ? 'gold' : undefined}>
              {t('frames.summary.review', { done: summary.baselined, total: summary.total })}
            </Tag>
            <Tag color={summary.matches === summary.total ? 'success' : undefined}>
              {t('frames.summary.delivery', { done: summary.matches, total: summary.total })}
            </Tag>
            {summary.deviates > 0 && (
              <Tag color={'error'}>{t('frames.summary.deviates', { count: summary.deviates })}</Tag>
            )}
          </Flexbox>
        </Flexbox>
        {comments.canComment && (
          <Button
            icon={<Icon icon={MapPin} />}
            type={pinMode ? 'primary' : 'default'}
            onClick={() => setPinMode((value) => !value)}
          >
            {pinMode ? t('frames.pin.active') : t('frames.pin.toggle')}
          </Button>
        )}
      </Flexbox>

      <Flexbox horizontal align={'center'} gap={10} wrap={'wrap'} {...stylex.props(styles.legend)}>
        <Icon color={cssVar.colorTextTertiary} icon={Info} size={14} />
        <SourceBadge source={'mock'} />
        <Text fontSize={12}>{t('frames.legend.mock')}</Text>
        <SourceBadge source={'real'} />
        <Text fontSize={12}>{t('frames.legend.real')}</Text>
        <Text fontSize={12} type={'secondary'}>
          {t('frames.legend.rule')}
        </Text>
      </Flexbox>

      <Flexbox horizontal align={'flex-start'} {...stylex.props(styles.strip)}>
        {board.frames.map((frame, index) => (
          <Fragment key={frame.id}>
            {index > 0 && (
              <TransitionArrow
                activeFrameId={active?.id}
                transitions={between[index - 1]}
                onFollow={setActiveId}
              />
            )}
            <FrameColumn
              active={frame.id === active?.id}
              board={board}
              frame={frame}
              frameThreads={threadsOf(frame.id)}
              index={index}
              previewVersionId={previewIds[frame.id]}
              onActivate={() => setActiveId(frame.id)}
              onUpdate={(operation) => update(frame.id, operation)}
              onPreview={(versionId) =>
                setPreviewIds((current) => ({ ...current, [frame.id]: versionId }))
              }
            />
          </Fragment>
        ))}
      </Flexbox>

      {others.length > 0 && (
        <Flexbox gap={4}>
          <Text strong fontSize={12}>
            {t('frames.transitions.other')}
          </Text>
          {others.map((transition) => (
            <Text fontSize={12} key={transition.id} type={'secondary'}>
              {t('frames.transitions.item', {
                from: titleOf(transition.fromFrameId),
                to: titleOf(transition.toFrameId),
                trigger: transition.trigger,
              })}
            </Text>
          ))}
        </Flexbox>
      )}

      {active && (
        <FrameDetail
          board={board}
          comments={comments}
          frame={active}
          frameThreads={threadsOf(active.id)}
          pinMode={pinMode}
          previewVersionId={previewIds[active.id]}
          onUpdate={(operation) => update(active.id, operation)}
        />
      )}
    </Flexbox>
  );
};
