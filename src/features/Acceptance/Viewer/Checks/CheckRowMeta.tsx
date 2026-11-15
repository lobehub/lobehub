import { cssVar, Flexbox, Icon, Tooltip } from '@lobehub/ui';
import * as stylex from '@stylexjs/stylex';
import dayjs from 'dayjs';
import { AudioLines, FileText, Film, Images, MessageSquare, Repeat } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import type { readVisualizationManifest } from '../../Report/visualization';
import { VisualizationDeltaBadge } from '../../Report/VisualizationRenderer';
import type { evidenceCounts } from '../Evidence/evidence';
import type { CheckDecision } from './checkDecision';
import { DECISION_ICON, DECISION_LABEL_KEY } from './checkDecision';
import { styles } from './styles';
import type { AcceptanceCheck } from './types';

const EVIDENCE_BADGES = [
  { icon: Images, key: 'image', labelKey: 'acceptance.evidence.image' },
  { icon: Film, key: 'video', labelKey: 'acceptance.evidence.video' },
  { icon: AudioLines, key: 'audio', labelKey: 'acceptance.evidence.audio' },
  { icon: FileText, key: 'file', labelKey: 'acceptance.evidence.file' },
] as const;

interface CheckRowMetaProps {
  check: AcceptanceCheck;
  checkThreadCount: number;
  counts: ReturnType<typeof evidenceCounts>;
  decision: CheckDecision;
  onRound?: (round: number) => void;
  visualization: ReturnType<typeof readVisualizationManifest>;
}

export const CheckRowMeta = memo<CheckRowMetaProps>(
  ({ check, checkThreadCount, counts, decision, onRound, visualization }) => {
    const { t } = useTranslation('verify');
    const DecisionIcon = DECISION_ICON[decision];

    const decisionHint = () => {
      if (decision === 'needsFix') return t('acceptance.review.rejectedHint');
      if (decision === 'accepted' && check.userReview)
        return t('acceptance.review.acceptedNote', {
          time: dayjs(check.userReview.createdAt).format('MM-DD HH:mm'),
        });
      return undefined;
    };

    return (
      <Flexbox horizontal align={'center'} gap={6} {...stylex.props(styles.rowMeta)}>
        {visualization && <VisualizationDeltaBadge manifest={visualization} />}
        {EVIDENCE_BADGES.map(({ icon, key, labelKey }) =>
          counts[key] ? (
            <Tooltip key={key} title={t(labelKey, { count: counts[key] })}>
              <Flexbox
                horizontal
                align={'center'}
                gap={3}
                style={{ color: cssVar.colorTextTertiary, fontSize: 12 }}
              >
                <Icon icon={icon} size={13} />
                {counts[key] > 1 ? counts[key] : null}
              </Flexbox>
            </Tooltip>
          ) : null,
        )}
        {checkThreadCount > 0 && (
          <Tooltip title={t('acceptance.comments.regionCount', { count: checkThreadCount })}>
            <Flexbox
              horizontal
              align={'center'}
              gap={3}
              style={{ color: cssVar.colorTextTertiary, fontSize: 12 }}
            >
              <Icon icon={MessageSquare} size={13} />
              {checkThreadCount}
            </Flexbox>
          </Tooltip>
        )}
        {/* The iteration mark stays compact — [↻ N]; the words (verified N
        rounds · introduced in round X) live in its tooltip. Clicking
        jumps to the round the concern first appeared in. */}
        {onRound && check.revisions > 1 && (
          <Tooltip
            title={[
              check.titleChanged
                ? t('acceptance.checks.iterated', { count: check.revisions })
                : t('acceptance.checks.rerun', { count: check.revisions }),
              check.resultRound !== undefined &&
              check.resultRound !== null &&
              check.introducedAtRound !== check.resultRound
                ? t('acceptance.checks.introduced', { round: check.introducedAtRound })
                : null,
            ]
              .filter(Boolean)
              .join(' · ')}
          >
            <span
              {...stylex.props(styles.chip, styles.chipClickable)}
              onClick={(event) => {
                event.stopPropagation();
                onRound(check.introducedAtRound);
              }}
            >
              <Icon icon={Repeat} size={12} /> {check.revisions}
            </span>
          </Tooltip>
        )}
        {onRound && check.resultRound !== undefined && check.resultRound !== null && (
          <Tooltip title={t('acceptance.checks.finalRoundHint')}>
            <span
              {...stylex.props(styles.chip, styles.chipClickable)}
              onClick={(event) => {
                event.stopPropagation();
                onRound(check.resultRound!);
              }}
            >
              {t('acceptance.round', { round: check.resultRound })}
            </span>
          </Tooltip>
        )}
        <Tooltip title={decisionHint()}>
          <span
            data-decision={decision}
            {...stylex.props(
              styles.decision,
              decision === 'accepted' && styles.decisionAccepted,
              decision === 'needsFix' && styles.decisionNeedsFix,
              decision === 'notRun' && styles.decisionNotRun,
            )}
          >
            {DecisionIcon && <Icon icon={DecisionIcon} size={14} />}
            {t(DECISION_LABEL_KEY[decision])}
          </span>
        </Tooltip>
      </Flexbox>
    );
  },
);

CheckRowMeta.displayName = 'AcceptanceCheckRowMeta';
