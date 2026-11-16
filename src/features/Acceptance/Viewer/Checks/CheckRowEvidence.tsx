import { cssVar, Flexbox, Icon, Text } from '@lobehub/ui';
import * as stylex from '@stylexjs/stylex';
import { CircleDashed } from 'lucide-react';
import type { ComponentProps } from 'react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { sx } from '@/styles/sx';

import type { readVisualizationManifest } from '../../Report/visualization';
import { VisualizationRenderer } from '../../Report/VisualizationRenderer';
import { HistoricalComments } from '../Comments/HistoricalComments';
import type { useCheckComments } from '../Comments/useCheckComments';
import { EvidenceList } from '../Evidence/EvidenceList';
import { styles } from './styles';
import type { AcceptanceCheck, AcceptanceCheckReviewEntry, AcceptanceEvidence } from './types';

interface CheckRowEvidenceProps {
  activeReview?: AcceptanceCheckReviewEntry;
  check: AcceptanceCheck;
  checkComments: ReturnType<typeof useCheckComments>;
  evidenceById: Map<string, AcceptanceEvidence>;
  fillStage: boolean;
  floatingComment: ComponentProps<typeof EvidenceList>['onComment'];
  onReviewEvidence?: (evidenceId: string) => void;
  visualization: ReturnType<typeof readVisualizationManifest>;
}

export const CheckRowEvidence = memo<CheckRowEvidenceProps>(
  ({
    activeReview,
    check,
    checkComments,
    evidenceById,
    fillStage,
    floatingComment,
    onReviewEvidence,
    visualization,
  }) => {
    const { t } = useTranslation('verify');
    const {
      canResolveThread,
      commentActions,
      commentOverlays,
      comments,
      refreshEvidenceUrl,
      staleThreads,
    } = checkComments;

    return (
      <Flexbox gap={12} {...sx(fillStage && styles.detailEvidence, { minWidth: 0 })}>
        {visualization && <VisualizationRenderer manifest={visualization} />}
        <EvidenceList
          evidence={check.evidence}
          overlays={commentOverlays}
          reviewNotes={activeReview?.action === 'reject' ? activeReview.annotations : undefined}
          stageSize={fillStage ? 'fill' : undefined}
          onComment={floatingComment}
          onRefreshEvidenceUrl={refreshEvidenceUrl}
          onReviewEvidence={onReviewEvidence}
        />
        {staleThreads.length > 0 && (
          <Flexbox gap={10} {...stylex.props(styles.staleRegions)}>
            <Text fontSize={12} type={'secondary'}>
              {t('acceptance.comments.historicalRegions', { count: staleThreads.length })}
            </Text>
            <HistoricalComments
              canComment={comments.canComment}
              canResolveThread={canResolveThread}
              evidenceById={evidenceById}
              overlays={commentOverlays}
              threads={staleThreads}
              timeline={check.timeline}
              onRefreshEvidenceUrl={refreshEvidenceUrl}
              {...commentActions}
            />
          </Flexbox>
        )}
        {check.state === 'not_executed' && (
          <Flexbox
            horizontal
            align={'center'}
            gap={8}
            paddingBlock={8}
            paddingInline={10}
            style={{
              background: cssVar.colorFillQuaternary,
              borderRadius: cssVar.borderRadius,
              width: '100%',
            }}
          >
            <Icon
              color={cssVar.colorTextQuaternary}
              icon={CircleDashed}
              size={15}
              style={{ flex: 'none' }}
            />
            <Text fontSize={12} type={'secondary'}>
              {t('acceptance.focus.verifierDescription.notExecuted')}
            </Text>
          </Flexbox>
        )}
      </Flexbox>
    );
  },
);

CheckRowEvidence.displayName = 'AcceptanceCheckRowEvidence';
