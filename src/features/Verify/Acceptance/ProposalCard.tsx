'use client';

import type { AcceptanceReviewAnnotation } from '@lobechat/types';
import { Flexbox, Icon, Text } from '@lobehub/ui';
import { Button } from '@lobehub/ui/base-ui';
import { createStaticStyles, cssVar } from 'antd-style';
import { Sparkles } from 'lucide-react';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { AnnotatedImage } from './Annotation';
import type { CheckProposal } from './proposal';

const styles = createStaticStyles(({ css }) => ({
  /* Warning, never error: this is a suggestion awaiting judgement, and the
     error palette already means "this check failed" on the same row. */
  card: css`
    padding-block: 10px;
    padding-inline: 12px;
    border: 1px solid ${cssVar.colorWarningBorder};
    border-radius: ${cssVar.borderRadiusLG};

    background: ${cssVar.colorWarningBg};
  `,
  meta: css`
    font-size: 11px;
    color: ${cssVar.colorTextQuaternary};
  `,
  title: css`
    font-size: 12px;
    font-weight: 500;
    color: ${cssVar.colorWarningText};
  `,
}));

interface ProposalCardProps {
  /** Evidence images by id, so a circled region renders on the frame it was drawn on. */
  evidenceById: Map<string, { fileUrl?: string | null }>;
  onAdjudicate: (adjudication: 'not-an-issue' | 'misidentified') => Promise<void> | void;
  /** Opens the prefilled reject modal — the confirm path. */
  onConfirm: () => void;
  pending?: boolean;
  proposal: CheckProposal;
}

/**
 * An automated reviewer's proposal on one check, with the three-way response.
 *
 * The three buttons are not cosmetic. A flat accept/dismiss pair would merge two
 * opposite training signals — "there is no problem here" and "there IS a problem
 * but you circled the wrong thing" — and the second is a POSITIVE signal on the
 * judgement. Collapsing them teaches the model that speaking up is risky, which
 * is precisely the wrong lesson for a reviewer whose measured failure mode is
 * being too lenient.
 */
const ProposalCard = memo<ProposalCardProps>(
  ({ evidenceById, onAdjudicate, onConfirm, pending, proposal }) => {
    const { t } = useTranslation('verify');
    const [busy, setBusy] = useState<'not-an-issue' | 'misidentified' | null>(null);

    const respond = async (adjudication: 'not-an-issue' | 'misidentified') => {
      setBusy(adjudication);
      try {
        await onAdjudicate(adjudication);
      } finally {
        setBusy(null);
      }
    };

    // Group the model's regions by the frame they belong to, so each image
    // renders once with all of its boxes.
    const byEvidence = new Map<string, AcceptanceReviewAnnotation[]>();
    for (const annotation of proposal.annotations ?? []) {
      const list = byEvidence.get(annotation.evidenceId) ?? [];
      list.push(annotation);
      byEvidence.set(annotation.evidenceId, list);
    }

    return (
      <Flexbox className={styles.card} gap={8}>
        <Flexbox horizontal align={'center'} gap={6}>
          <Icon icon={Sparkles} size={13} />
          <span className={styles.title}>{t('acceptance.proposal.title')}</span>
          <span className={styles.meta}>{proposal.modelId}</span>
        </Flexbox>

        {proposal.comment && <Text fontSize={13}>{proposal.comment}</Text>}

        {[...byEvidence.entries()].map(([evidenceId, annotations]) => {
          const url = evidenceById.get(evidenceId)?.fileUrl;
          if (!url) return null;
          return (
            <AnnotatedImage
              annotations={annotations}
              imageStyle={{ maxHeight: 220, width: 'auto' }}
              key={evidenceId}
              src={url}
            />
          );
        })}

        <Flexbox horizontal gap={8} wrap={'wrap'}>
          <Button
            disabled={pending || Boolean(busy)}
            size={'small'}
            type={'primary'}
            onClick={onConfirm}
          >
            {t('acceptance.proposal.confirm')}
          </Button>
          <Button
            disabled={pending || Boolean(busy)}
            loading={busy === 'not-an-issue'}
            size={'small'}
            onClick={() => respond('not-an-issue')}
          >
            {t('acceptance.proposal.notAnIssue')}
          </Button>
          <Button
            disabled={pending || Boolean(busy)}
            loading={busy === 'misidentified'}
            size={'small'}
            type={'text'}
            onClick={() => respond('misidentified')}
          >
            {t('acceptance.proposal.misidentified')}
          </Button>
        </Flexbox>
      </Flexbox>
    );
  },
);

ProposalCard.displayName = 'AcceptanceProposalCard';

export default ProposalCard;
