'use client';

import { ActionIcon, Button, Flexbox, Icon, Select, Text, toast } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { BadgeCheck, Check, MessageSquareX, RotateCcw, X } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { type AcceptanceBundle, verifyService } from '@/services/verify';
import { sx } from '@/styles/sx';

import { AttachmentThumbs } from '../Evidence/attachments';
import { EvidenceList } from '../Evidence/EvidenceList';
import { openCheckRejectModal } from '../Review/CheckRejectModal';
import { flowStateColor, flowStateIcon } from './FlowNode';
import { hasReviewRecord } from './flowStoryboard';

type FlowVersion = AcceptanceBundle['flows'][number]['versions'][number];
type FlowAttempt = FlowVersion['runs'][number]['attempts'][number];

const MAX_ATTEMPT_TABS = 3;

const REVIEW_LABEL_KEY = {
  accepted: 'acceptance.focus.state.accepted',
  pending: 'acceptance.focus.state.pending',
  rejected: 'acceptance.focus.state.needsFix',
} as const;

const styles = stylex.create({
  panel: {
    overflow: 'hidden',
    width: '100%',
    height: '100%',
    minHeight: 0,
    borderInlineStartWidth: '1px',
    borderInlineStartStyle: 'solid',
    borderInlineStartColor: cssVar.colorBorderSecondary,
    backgroundColor: cssVar.colorBgContainer,
  },
  header: {
    flex: 'none',
    padding: '16px',
    borderBlockEndWidth: '1px',
    borderBlockEndStyle: 'solid',
    borderBlockEndColor: cssVar.colorBorderSecondary,
  },
  path: {
    fontSize: '12px',
    lineHeight: '20px',
    color: cssVar.colorTextTertiary,
  },
  title: {
    margin: 0,
    fontSize: '16px',
    fontWeight: 600,
    lineHeight: '24px',
  },
  status: {
    display: 'inline-flex',
    gap: '4px',
    alignItems: 'center',
    fontSize: '12px',
    lineHeight: '20px',
    color: cssVar.colorTextSecondary,
  },
  statusAccepted: { color: cssVar.colorSuccessText },
  statusRejected: { color: cssVar.colorErrorText },
  body: {
    overflow: 'auto',
    flex: '1',
    minHeight: 0,
    padding: '16px',
  },
  attemptTabs: {
    display: 'inline-flex',
    alignSelf: 'flex-start',
    gap: '2px',
    padding: '2px',
    borderRadius: '8px',
    backgroundColor: cssVar.colorFillTertiary,
  },
  attemptTab: {
    cursor: 'pointer',
    height: '28px',
    margin: 0,
    paddingBlock: 0,
    paddingInline: '12px',
    borderWidth: 0,
    borderStyle: 'none',
    borderColor: 'currentcolor',
    borderRadius: '6px',
    font: 'inherit',
    fontSize: '12px',
    color: { 'default': cssVar.colorTextSecondary, ':hover': cssVar.colorText },
    whiteSpace: 'nowrap',
    backgroundColor: 'transparent',
    outlineWidth: { 'default': 0, ':focus-visible': '2px' },
    outlineStyle: { 'default': 'none', ':focus-visible': 'solid' },
    outlineColor: cssVar.colorPrimary,
  },
  attemptTabActive: {
    fontWeight: 500,
    color: { 'default': cssVar.colorText, ':hover': cssVar.colorText },
    backgroundColor: cssVar.colorBgContainer,
    boxShadow: cssVar.boxShadowTertiary,
  },
  compare: {
    display: 'grid',
    gridTemplateColumns: '88px minmax(0, 1fr)',
    columnGap: '16px',
    rowGap: '8px',
    margin: 0,
  },
  compareTerm: {
    fontSize: '12px',
    lineHeight: '22px',
    color: cssVar.colorTextSecondary,
  },
  compareValue: {
    margin: 0,
    lineHeight: '22px',
    overflowWrap: 'anywhere',
    whiteSpace: 'pre-wrap',
  },
  plan: {
    fontSize: '12px',
    color: cssVar.colorTextSecondary,
  },
  planSummary: {
    cursor: 'pointer',
    paddingBlock: '4px',
  },
  footer: {
    flex: 'none',
    paddingBlock: '12px',
    paddingInline: '16px',
    borderBlockStartWidth: '1px',
    borderBlockStartStyle: 'solid',
    borderBlockStartColor: cssVar.colorBorderSecondary,
  },
});

export function FlowResults({
  acceptanceId,
  attempts,
  canReview,
  edges,
  node,
  nodes,
  onClose,
  onSaved,
  position,
  selectedEdge,
}: {
  acceptanceId: string;
  attempts: FlowAttempt[];
  canReview: boolean;
  edges: FlowVersion['edges'];
  node: FlowVersion['nodes'][number];
  nodes: FlowVersion['nodes'];
  onClose: () => void;
  onSaved: () => Promise<unknown>;
  position?: { index: number; total: number };
  selectedEdge?: FlowVersion['edges'][number];
}) {
  const { t } = useTranslation('verify');
  const [attemptId, setAttemptId] = useState<string>();
  const [saving, setSaving] = useState(false);
  const ordered = [...attempts].reverse();
  const attempt = ordered.find((a) => a.id === attemptId) ?? ordered[0];
  const evidence =
    attempt?.evidence.filter((e) => e.fileUrl || e.content !== attempt.observation) ?? [];
  const overlays = new Map<
    string,
    NonNullable<NonNullable<FlowAttempt['reviewDetail']>['annotations']>
  >();
  for (const annotation of attempt?.reviewDetail?.annotations ?? [])
    overlays.set(annotation.evidenceId, [
      ...(overlays.get(annotation.evidenceId) ?? []),
      annotation,
    ]);

  const incoming = selectedEdge ?? edges.find((edge) => edge.id === attempt?.incomingEdgeId);
  const source = incoming && nodes.find((item) => item.nodeKey === incoming.sourceNodeKey);
  const reachedText = () => {
    if (!incoming) return undefined;
    if (!source) return t('flow.walk.reachedBy', { trigger: incoming.trigger });
    return t('flow.walk.reachedFrom', { source: source.title, trigger: incoming.trigger });
  };
  const pathText = [position ? t('flow.walk.position', position) : undefined, reachedText()]
    .filter(Boolean)
    .join(' · ');
  const attemptLabel = (item: FlowAttempt, index: number) =>
    index === 0
      ? t('flow.walk.latestAttempt', { number: item.sequence })
      : t('flow.walk.attempt', { number: item.sequence });

  const accept = async () => {
    if (!attempt) return;
    setSaving(true);
    try {
      await verifyService.reviewFlowStep({
        id: acceptanceId,
        attemptId: attempt.id,
        review: 'accepted',
        comment: attempt.reviewComment ?? '',
        annotations: attempt.reviewDetail?.annotations,
        fileIds: attempt.reviewDetail?.fileIds,
      });
      await onSaved();
    } catch (error) {
      console.error(error);
      toast.error(t('flow.saveError'));
    } finally {
      setSaving(false);
    }
  };

  const reject = () => {
    if (!attempt) return;
    openCheckRejectModal({
      checkTitle: node.title,
      draftKey: attempt.id,
      evidence: (attempt.evidence ?? [])
        .filter((e) => e.type === 'screenshot' && e.fileUrl)
        .map((e) => ({ id: e.id, fileUrl: e.fileUrl! })),
      initialAnnotations: attempt.reviewDetail?.annotations,
      initialComment: attempt.reviewComment ?? '',
      onConfirm: async (feedback) => {
        try {
          await verifyService.reviewFlowStep({
            id: acceptanceId,
            attemptId: attempt.id,
            review: 'rejected',
            ...feedback,
          });
          await onSaved();
          return true;
        } catch (error) {
          console.error(error);
          toast.error(t('flow.saveError'));
          return false;
        }
      },
    });
  };

  return (
    <Flexbox {...stylex.props(styles.panel)}>
      <Flexbox
        horizontal
        align="flex-start"
        gap={12}
        justify="space-between"
        {...stylex.props(styles.header)}
      >
        <Flexbox gap={4} style={{ minWidth: 0 }}>
          {pathText && <span {...stylex.props(styles.path)}>{pathText}</span>}
          <h2 {...stylex.props(styles.title)}>{node.title}</h2>
          <Flexbox horizontal align="center" gap={8} wrap="wrap">
            <span {...sx(styles.status, { color: flowStateColor(attempt?.verdict) })}>
              <Icon icon={flowStateIcon(attempt?.verdict)} size={14} />
              {t('acceptance.focus.judgeLabel')} ·{' '}
              {t(`flow.state.${attempt?.verdict ?? 'pending'}`)}
            </span>
            {attempt && (
              <span
                {...stylex.props(
                  styles.status,
                  attempt.review === 'accepted' && styles.statusAccepted,
                  attempt.review === 'rejected' && styles.statusRejected,
                )}
              >
                {attempt.review === 'accepted' && <Icon icon={BadgeCheck} size={14} />}
                {attempt.review === 'rejected' && <Icon icon={RotateCcw} size={14} />}
                {t(REVIEW_LABEL_KEY[attempt.review ?? 'pending'])}
              </span>
            )}
          </Flexbox>
        </Flexbox>
        <ActionIcon
          aria-label={t('flow.closeResults')}
          icon={X}
          title={t('flow.closeResults')}
          onClick={onClose}
        />
      </Flexbox>
      <Flexbox gap={16} {...stylex.props(styles.body)}>
        {ordered.length > 1 &&
          (ordered.length <= MAX_ATTEMPT_TABS ? (
            <div aria-label={t('flow.attempts')} role="group" {...stylex.props(styles.attemptTabs)}>
              {ordered.map((item, index) => (
                <button
                  aria-pressed={item.id === attempt?.id}
                  key={item.id}
                  type="button"
                  {...stylex.props(
                    styles.attemptTab,
                    item.id === attempt?.id && styles.attemptTabActive,
                  )}
                  onClick={() => setAttemptId(item.id)}
                >
                  {attemptLabel(item, index)}
                </button>
              ))}
            </div>
          ) : (
            <Select
              aria-label={t('flow.attempts')}
              value={attempt?.id}
              options={ordered.map((item, index) => ({
                value: item.id,
                label: `${attemptLabel(item, index)} · ${t(`flow.state.${item.verdict}`)}`,
              }))}
              onChange={(id) => setAttemptId(String(id))}
            />
          ))}
        {attempt && evidence.length > 0 && <EvidenceList evidence={evidence} overlays={overlays} />}
        <dl {...stylex.props(styles.compare)}>
          <dt {...stylex.props(styles.compareTerm)}>{t('flow.walk.expected')}</dt>
          <dd {...stylex.props(styles.compareValue)}>{node.expected}</dd>
          <dt {...stylex.props(styles.compareTerm)}>{t('flow.walk.observed')}</dt>
          <dd {...stylex.props(styles.compareValue)}>
            {attempt ? attempt.observation : <Text type="secondary">{t('flow.unvisited')}</Text>}
          </dd>
        </dl>
        {attempt && hasReviewRecord(attempt) && (
          <Flexbox gap={4}>
            <Text fontSize={12} type="secondary">
              {t('flow.comment')}
            </Text>
            {attempt.reviewComment && (
              <Text style={{ whiteSpace: 'pre-wrap' }}>{attempt.reviewComment}</Text>
            )}
            {attempt.reviewDetail?.annotations?.map((annotation, index) => (
              <Text fontSize={12} key={`${annotation.evidenceId}:${index}`} type="secondary">
                {index + 1}. {annotation.comment}
              </Text>
            ))}
            <AttachmentThumbs attachments={attempt.reviewAttachments} />
          </Flexbox>
        )}
        <details {...stylex.props(styles.plan)} open={!attempt}>
          <summary {...stylex.props(styles.planSummary)}>{t('flow.instruction')}</summary>
          <Text>{node.instruction}</Text>
        </details>
      </Flexbox>
      {attempt && canReview && (
        <Flexbox
          horizontal
          align="center"
          gap={8}
          justify="flex-end"
          {...stylex.props(styles.footer)}
        >
          <Button disabled={saving} icon={<Icon icon={MessageSquareX} />} onClick={reject}>
            {t('acceptance.review.reject')}
          </Button>
          <Button
            disabled={saving || attempt.review === 'accepted'}
            icon={<Icon icon={Check} />}
            loading={saving}
            type="primary"
            onClick={accept}
          >
            {t('acceptance.review.accept')}
          </Button>
        </Flexbox>
      )}
    </Flexbox>
  );
}
