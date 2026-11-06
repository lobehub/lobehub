import { Button, Flexbox, Icon, Text, toast } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { ArrowLeftIcon } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { verifyService } from '@/services/verify';

import { useBoard } from '../BoardContext';
import StatusTag from '../StatusTag';
import { artboardActions } from '../store';
import { nodeAttempts, nodeReview, nodeState } from './flow';
import { EmptyThumb, Thumb, thumbStyles } from './Thumb';
import { useBoardAcceptance } from './useJourneyView';

const styles = stylex.create({
  back: {
    cursor: 'pointer',
    marginBlockEnd: 8,
  },
  section: {
    borderBlockEndColor: cssVar.colorBorderSecondary,
    borderBlockEndStyle: 'solid',
    borderBlockEndWidth: 1,
    paddingBlock: 14,
  },
});

const CheckDetail = ({ frameId }: { frameId: string }) => {
  const { t } = useTranslation('project');
  const board = useBoard();
  const { acceptanceId, journey, refresh } = useBoardAcceptance();
  const [saving, setSaving] = useState(false);
  const frame = board.frameById[frameId];
  if (!frame) return null;

  const state = nodeState(journey, frameId);
  const attempts = nodeAttempts(journey, frameId);
  const verdictOf = (edgeId: string | null) =>
    attempts.find((attempt) => attempt.incomingEdgeId === edgeId)?.verdict;
  const paths = [
    ...(frameId === board.journeyEntryId ? [{ edgeId: null, label: null }] : []),
    ...board.journeyArrows
      .filter((arrow) => arrow.to === frameId)
      .map((arrow) => ({
        edgeId: journey?.edgeOf(arrow.id) ?? arrow.id,
        label: `${board.frameById[arrow.from]?.title} → ${arrow.label}`,
      })),
  ];
  const observation = attempts[0]?.observation;
  const shot = attempts
    .flatMap((attempt) => attempt.evidence)
    .find((e) => e.type === 'screenshot' && e.fileUrl)?.fileUrl;
  const review = nodeReview(journey, frameId);
  const reviewable = attempts.filter((a) => a.verdict === 'passed' || a.verdict === 'failed');

  const submitReview = async (verdict: 'accepted' | 'rejected') => {
    if (!acceptanceId) return;
    setSaving(true);
    try {
      await Promise.all(
        reviewable.map((attempt) =>
          verifyService.reviewFlowStep({
            attemptId: attempt.id,
            comment: '',
            id: acceptanceId,
            review: verdict,
          }),
        ),
      );
      await refresh();
      toast.success(
        t(verdict === 'accepted' ? 'artboard.verify.accepted' : 'artboard.verify.rejected', {
          id: frame.title,
        }),
      );
    } catch (error) {
      toast.error((error as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Flexbox gap={4}>
      <Flexbox
        horizontal
        align="center"
        gap={6}
        {...stylex.props(styles.back)}
        onClick={() => artboardActions.select(null)}
      >
        <Icon icon={ArrowLeftIcon} size={14} />
        <Text style={{ fontSize: 12 }} type="secondary">
          {t('artboard.verify.back')}
        </Text>
      </Flexbox>
      <Flexbox horizontal align="center" gap={8}>
        <StatusTag state={state} />
        <Text ellipsis style={{ fontSize: 12 }} type="secondary">
          {frame.title}
        </Text>
      </Flexbox>
      <Text strong style={{ fontSize: 15, marginTop: 6 }}>
        {frame.check?.expected}
      </Text>
      <Flexbox gap={6} {...stylex.props(styles.section)}>
        <Text style={{ fontSize: 12 }} type="secondary">
          {t('artboard.verify.paths')}
        </Text>
        {paths.map((path) => (
          <Flexbox horizontal align="center" gap={8} key={path.edgeId ?? 'entry'}>
            <Text style={{ flex: 1, fontSize: 13, minWidth: 0 }}>
              {path.label ?? t('artboard.verify.entry')}
            </Text>
            {journey?.run && <StatusTag state={verdictOf(path.edgeId)} />}
          </Flexbox>
        ))}
      </Flexbox>
      <Flexbox gap={8} {...stylex.props(styles.section)}>
        <Flexbox horizontal gap={8}>
          <Flexbox flex={1} gap={4} style={{ minWidth: 0 }}>
            <Text style={{ fontSize: 12 }} type="secondary">
              {t('artboard.verify.reference', {
                rev: frame.source.kind === 'canvas' ? frame.source.version : 1,
              })}
            </Text>
            <Thumb frame={frame} />
          </Flexbox>
          <Flexbox flex={1} gap={4} style={{ minWidth: 0 }}>
            <Text style={{ fontSize: 12 }} type="secondary">
              {t('artboard.verify.realShot')}
            </Text>
            {shot ? (
              <div {...stylex.props(thumbStyles.box)}>
                <img
                  alt={frame.title}
                  src={shot}
                  style={{ height: '100%', objectFit: 'cover', width: '100%' }}
                />
              </div>
            ) : (
              <EmptyThumb>{t('artboard.verify.noShot')}</EmptyThumb>
            )}
          </Flexbox>
        </Flexbox>
        {observation && (
          <Text style={{ fontSize: 13 }} type={state === 'failed' ? 'danger' : undefined}>
            {t('artboard.verify.observation', { text: observation })}
          </Text>
        )}
      </Flexbox>
      {acceptanceId && reviewable.length > 0 && (
        <Flexbox gap={8} style={{ paddingTop: 14 }}>
          <Text style={{ fontSize: 12 }} type="secondary">
            {t('artboard.verify.reviewTitle')}
          </Text>
          {review ? (
            <Text>
              {t(
                review === 'accepted'
                  ? 'artboard.verify.reviewAccepted'
                  : 'artboard.verify.reviewRejected',
              )}
            </Text>
          ) : (
            <Flexbox horizontal gap={8}>
              <Button loading={saving} onClick={() => submitReview('accepted')}>
                {t('artboard.verify.accept')}
              </Button>
              <Button danger loading={saving} onClick={() => submitReview('rejected')}>
                {t(state === 'failed' ? 'artboard.verify.rejectFailed' : 'artboard.verify.reject')}
              </Button>
            </Flexbox>
          )}
        </Flexbox>
      )}
    </Flexbox>
  );
};

export default CheckDetail;
