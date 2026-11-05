'use client';

import { Button, Flexbox, Icon, Text } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { ChevronDown, ChevronRight, Sparkles } from 'lucide-react';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { CheckProposal } from './proposal';

const styles = stylex.create({
  card: {
    paddingBlock: '8px',
    paddingInline: '10px',
    borderWidth: '1px',
    borderStyle: 'dashed',
    borderColor: cssVar.colorBorder,
    borderRadius: cssVar.borderRadiusLG,
  },
  head: { cursor: 'pointer', userSelect: 'none' },
  preview: {
    overflow: 'hidden',
    flex: '1',
    minWidth: '0',
    fontSize: '12px',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  muted: { fontSize: '11px', color: cssVar.colorTextQuaternary },
  regionIndex: {
    flex: 'none',
    width: '16px',
    height: '16px',
    borderRadius: '50%',
    fontSize: '10px',
    fontWeight: 600,
    lineHeight: '16px',
    color: '#fff',
    textAlign: 'center',
    backgroundColor: cssVar.colorError,
    backgroundImage: 'none',
  },
});

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
      <Flexbox className={stylex.props(styles.card).className} gap={open ? 8 : 0}>
        <Flexbox
          horizontal
          align={'center'}
          className={stylex.props(styles.head).className}
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
            <span {...stylex.props(styles.muted)}>
              {proposal.provider}/{proposal.model}
            </span>
          )}
          {!open && proposal.comment && (
            <span {...stylex.props(styles.preview)}>{proposal.comment}</span>
          )}
          {!open && regions.length > 0 && (
            <span {...stylex.props(styles.muted)}>
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
                <span
                  className={stylex.props(styles.regionIndex).className}
                  style={{ marginBlockStart: 2 }}
                >
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
