import { Flexbox, Image, PreviewGroup, Text } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { useBoard } from '../BoardContext';
import { boardFileUrl } from '../model';
import StatusTag from '../StatusTag';
import { artboardActions } from '../store';
import { isFlagged, nodeAttempts, nodeScreenshot, nodeState } from './flow';
import ReviewActions from './ReviewActions';
import { useCheckBoards } from './Summary';
import { EmptyThumb, Thumb, thumbStyles } from './Thumb';
import { useCheckReview } from './useCheckReview';
import { useBoardAcceptance } from './useJourneyView';

const styles = stylex.create({
  body: {
    flex: '1',
    minHeight: 0,
    overflowY: 'auto',
    paddingBlock: 14,
    paddingInline: 16,
  },
  fact: {
    borderBlockEndColor: cssVar.colorBorderSecondary,
    borderBlockEndStyle: 'solid',
    borderBlockEndWidth: 1,
    columnGap: 12,
    display: 'grid',
    gridTemplateColumns: '64px minmax(0, 1fr)',
    paddingBlock: 8,
  },
  factLabel: {
    color: cssVar.colorTextTertiary,
    fontSize: 12,
    lineHeight: 1.8,
  },
  factValue: {
    fontSize: 13,
    lineHeight: 1.65,
  },
  foot: {
    alignItems: 'flex-start',
    flexDirection: 'column',
    borderBlockStartColor: cssVar.colorBorderSecondary,
    borderBlockStartStyle: 'solid',
    borderBlockStartWidth: 1,
    display: 'flex',
    flex: 'none',
    gap: 8,
    paddingBlock: 12,
    paddingInline: 16,
  },
  path: {
    backgroundColor: cssVar.colorFillSecondary,
    borderRadius: 6,
    color: cssVar.colorTextSecondary,
    display: 'inline-block',
    fontSize: 12,
    paddingBlock: 2,
    paddingInline: 8,
  },
  design: {
    cursor: 'zoom-in',
    display: 'flex',
    flex: '1',
    minWidth: 0,
  },
  evidence: {
    borderColor: cssVar.colorBorderSecondary,
    borderRadius: 4,
    borderStyle: 'solid',
    borderWidth: 1,
    flex: 'none',
    height: 36,
    overflow: 'hidden',
    width: 58,
  },
});

const ShotImage = ({ alt, src }: { alt: string; src: string }) => (
  <Image
    alt={alt}
    height={'100%'}
    objectFit={'cover'}
    src={src}
    styles={{ image: { objectPosition: 'top' }, wrapper: { height: '100%', width: '100%' } }}
    variant={'borderless'}
    width={'100%'}
  />
);

const Fact = ({ children, label }: { children: ReactNode; label: string }) => (
  <div {...stylex.props(styles.fact)}>
    <span {...stylex.props(styles.factLabel)}>{label}</span>
    <div {...stylex.props(styles.factValue)}>{children}</div>
  </div>
);

const CheckDetail = ({ boardId }: { boardId: string }) => {
  const { t } = useTranslation('project');
  const board = useBoard();
  const checks = useCheckBoards();
  const { journey } = useBoardAcceptance();
  const { canReview } = useCheckReview(boardId);
  const item = board.boardById[boardId];
  if (!item) return null;

  const state = nodeState(journey, boardId);
  const attempts = nodeAttempts(journey, boardId);
  const nodeKey = journey?.nodeOf(boardId);
  const verdictOf = (edgeId: string | null) =>
    attempts.find((attempt) => attempt.incomingEdgeId === edgeId)?.verdict;
  const paths = [
    ...(boardId === board.journeyEntryId ? [{ edgeId: null, label: null }] : []),
    ...(journey && nodeKey ? journey.version.edges : [])
      .filter((edge) => edge.targetNodeKey === nodeKey)
      .map((edge) => {
        const from = journey?.boardOf(edge.sourceNodeKey);
        const step = edge.condition ? `${edge.trigger} · ${edge.condition}` : edge.trigger;
        return {
          edgeId: edge.id,
          label: `${(from && board.boardById[from]?.title) ?? ''} → ${step}`,
        };
      }),
  ];
  const observation = attempts.find((attempt) => attempt.observation)?.observation;
  const shot = nodeScreenshot(journey, boardId);
  const shots = [
    ...new Set(
      attempts.flatMap((attempt) =>
        attempt.evidence.flatMap((e) => (e.type === 'screenshot' && e.fileUrl ? [e.fileUrl] : [])),
      ),
    ),
  ];
  const designUrl = boardFileUrl(board, item);
  const designImage = item.type === 'image' ? designUrl : undefined;
  const openDesign = () => {
    if (designUrl) window.open(designUrl, '_blank', 'noopener');
  };
  const next = checks[checks.findIndex((check) => check.id === boardId) + 1];

  return (
    <>
      <PreviewGroup>
        <div {...stylex.props(styles.body)}>
          <Flexbox horizontal align="center" gap={8} style={{ minWidth: 0 }}>
            <Text strong style={{ fontSize: 15 }}>
              {item.title}
            </Text>
            {isFlagged(state) && <StatusTag state={state} />}
          </Flexbox>
          <Flexbox horizontal gap={8} style={{ marginBlock: 12 }}>
            <Flexbox flex={1} gap={4} style={{ minWidth: 0 }}>
              <Text style={{ fontSize: 12 }} type="secondary">
                {t('artboard.verify.finalizedReference')}
              </Text>
              <div
                role="button"
                tabIndex={0}
                title={t('artboard.verify.openDesign')}
                {...stylex.props(styles.design)}
                onClick={openDesign}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    openDesign();
                  }
                }}
              >
                <Thumb board={item} />
              </div>
            </Flexbox>
            <Flexbox flex={1} gap={4} style={{ minWidth: 0 }}>
              <Text style={{ fontSize: 12 }} type="secondary">
                {t('artboard.verify.realShot')}
              </Text>
              {shot ? (
                <div {...stylex.props(thumbStyles.box)}>
                  <ShotImage alt={item.title} src={shot} />
                </div>
              ) : (
                <EmptyThumb>{t('artboard.verify.noShot')}</EmptyThumb>
              )}
            </Flexbox>
          </Flexbox>
          <Fact label={t('artboard.verify.expected')}>{item.expected}</Fact>
          {observation && (
            <Fact label={t('artboard.verify.observed')}>
              <Text type={state === 'failed' ? 'danger' : undefined}>{observation}</Text>
            </Fact>
          )}
          <Fact label={t('artboard.verify.path')}>
            <Flexbox gap={6}>
              {paths.map((path) => (
                <Flexbox horizontal align="center" gap={8} key={path.edgeId ?? 'entry'}>
                  <span {...stylex.props(styles.path)}>
                    {path.label ?? t('artboard.verify.entry')}
                  </span>
                  {isFlagged(verdictOf(path.edgeId)) && (
                    <StatusTag state={verdictOf(path.edgeId)} />
                  )}
                </Flexbox>
              ))}
            </Flexbox>
          </Fact>
          {shots.length > 0 && (
            <Fact label={t('artboard.verify.evidence')}>
              <Flexbox horizontal align="center" gap={6} wrap="wrap">
                {shots.map((url) => (
                  <div key={url} {...stylex.props(styles.evidence)}>
                    <ShotImage alt={item.title} src={url} />
                  </div>
                ))}
                <Text style={{ fontSize: 12 }} type="secondary">
                  {t('artboard.verify.evidenceCount', { count: shots.length })}
                </Text>
              </Flexbox>
            </Fact>
          )}
        </div>
      </PreviewGroup>
      {canReview && (
        <div {...stylex.props(styles.foot)}>
          <ReviewActions
            boardId={boardId}
            state={state}
            onReviewed={(verdict) => {
              if (verdict === 'accepted' && next) artboardActions.focusItem(next.id);
            }}
          />
          {next && (
            <Text style={{ fontSize: 12 }} type="secondary">
              {t('artboard.verify.nextHint')}
            </Text>
          )}
        </div>
      )}
    </>
  );
};

export default CheckDetail;
