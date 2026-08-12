'use client';

import { Flexbox, Icon, Text } from '@lobehub/ui';
import { Button } from '@lobehub/ui/base-ui';
import { createStaticStyles, cssVar } from 'antd-style';
import { ChevronDown, ChevronRight, Sparkles } from 'lucide-react';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { CheckProposal } from './proposal';

const styles = createStaticStyles(({ css }) => ({
  /* Dashed and untinted: a proposal is a suggestion sitting next to real
     verdicts, so it must read as provisional rather than as another state the
     check has already reached. A solid tinted panel competed with the check's
     own status colour for the same glance. */
  card: css`
    padding-block: 8px;
    padding-inline: 10px;
    border: 1px dashed ${cssVar.colorBorder};
    border-radius: ${cssVar.borderRadiusLG};
  `,
  head: css`
    cursor: pointer;
    user-select: none;
  `,
  /* The collapsed line carries the whole claim, so the reviewer can skip the
     proposal without opening it. */
  preview: css`
    overflow: hidden;
    flex: 1;

    min-width: 0;

    font-size: 12px;
    text-overflow: ellipsis;
    white-space: nowrap;
  `,
  /* Quieter than `secondary` — these are provenance labels, not content. */
  muted: css`
    font-size: 11px;
    color: ${cssVar.colorTextQuaternary};
  `,
  regionIndex: css`
    flex: none;

    width: 16px;
    height: 16px;
    border-radius: 50%;

    font-size: 10px;
    font-weight: 600;
    line-height: 16px;
    color: #fff;
    text-align: center;

    background: ${cssVar.colorError};
  `,
}));

interface ProposalCardProps {
  onAdjudicate: (adjudication: 'misidentified' | 'not-an-issue') => Promise<void> | void;
  /** Opens the prefilled reject modal — the confirm path. */
  onConfirm: () => void;
  /** Report expansion up so the evidence images below can show/hide the overlay. */
  onToggle: (open: boolean) => void;
  open: boolean;
  pending?: boolean;
  proposal: CheckProposal;
}

/**
 * An automated reviewer's proposal on one check.
 *
 * Deliberately carries NO image of its own: the evidence it is talking about
 * already renders directly below, and a second copy made the same screenshot
 * appear twice in one row. Opening this card instead draws the model's regions
 * onto that existing image, with badge numbers matching the list here.
 *
 * The three responses are not cosmetic. A flat accept/dismiss pair would merge
 * two opposite training signals — "there is no problem here" and "there IS a
 * problem but you circled the wrong thing" — and the second is a POSITIVE
 * signal on the judgement. Collapsing them teaches the model that speaking up
 * is risky, which is the wrong lesson for a reviewer whose measured failure
 * mode is being too lenient.
 */
const ProposalCard = memo<ProposalCardProps>(
  ({ onAdjudicate, onConfirm, onToggle, open, pending, proposal }) => {
    const { t } = useTranslation('verify');
    const [busy, setBusy] = useState<'misidentified' | 'not-an-issue' | null>(null);

    const respond = async (adjudication: 'misidentified' | 'not-an-issue') => {
      setBusy(adjudication);
      try {
        await onAdjudicate(adjudication);
      } finally {
        setBusy(null);
      }
    };

    const regions = proposal.annotations ?? [];

    return (
      <Flexbox className={styles.card} gap={open ? 8 : 0}>
        <Flexbox
          horizontal
          align={'center'}
          className={styles.head}
          gap={6}
          onClick={() => onToggle(!open)}
        >
          <Icon icon={open ? ChevronDown : ChevronRight} size={12} />
          <Icon icon={Sparkles} size={12} />
          <Text fontSize={12} style={{ flex: 'none' }} type={'secondary'}>
            {t('acceptance.proposal.title')}
          </Text>
          {/* Provenance sits beside the claim it qualifies, but only once the
              card is open. Collapsed, the row's job is the finding itself —
              a model id there just pushes the summary out of view. */}
          {open && (
            <span className={styles.muted}>
              {proposal.provider}/{proposal.model}
            </span>
          )}
          {!open && proposal.comment && <span className={styles.preview}>{proposal.comment}</span>}
          {!open && regions.length > 0 && (
            <span className={styles.muted}>
              {t('acceptance.proposal.regionCount', { count: regions.length })}
            </span>
          )}
        </Flexbox>

        {open && (
          <>
            {proposal.comment && <Text fontSize={12}>{proposal.comment}</Text>}

            {/* Numbers match the badges now drawn on the evidence image below. */}
            {regions.map((region, index) => (
              <Flexbox horizontal align={'flex-start'} gap={6} key={index}>
                <span className={styles.regionIndex} style={{ marginBlockStart: 2 }}>
                  {index + 1}
                </span>
                <Text fontSize={12} type={'secondary'}>
                  {region.comment || t('acceptance.proposal.regionUnnamed')}
                </Text>
              </Flexbox>
            ))}

            <Flexbox horizontal align={'center'} gap={8} wrap={'wrap'}>
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
          </>
        )}
      </Flexbox>
    );
  },
);

ProposalCard.displayName = 'AcceptanceProposalCard';

export default ProposalCard;
