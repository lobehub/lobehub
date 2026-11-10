'use client';

import type { VerifyCheckDispute, VerifyDisputeVote } from '@lobechat/types';
import { cssVar, Flexbox, Icon, Text } from '@lobehub/ui';
import { ChevronRight, Scale } from 'lucide-react';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { tallyDisputeVotes } from './dispute';
import FoldedText from './FoldedText';

const OUTCOME_COLOR = {
  overruled: cssVar.colorTextSecondary,
  undecided: cssVar.colorTextSecondary,
  upheld: cssVar.colorSuccess,
} as const;

const voteLabelKey = (vote: VerifyDisputeVote) =>
  vote.status !== 'judged'
    ? ('acceptance.dispute.vote.errored' as const)
    : vote.upheld
      ? ('acceptance.dispute.vote.upheld' as const)
      : ('acceptance.dispute.vote.overruled' as const);

/**
 * The builder's objection to this check, read-only. Secondary to the verdict,
 * so it stays one quiet block: kind + note, and for an arbitrated dispute the
 * panel's outcome with its votes folded behind the tally.
 */
const DisputeNote = memo<{ dispute: VerifyCheckDispute }>(({ dispute }) => {
  const { t } = useTranslation('verify');
  const [votesOpen, setVotesOpen] = useState(false);
  const arbitration = dispute.kind === 'invalid_criterion' ? dispute.arbitration : undefined;
  const tally = arbitration ? tallyDisputeVotes(arbitration) : undefined;
  // An older server may send a ruling without its votes.
  const votes = arbitration?.votes ?? [];

  return (
    <Flexbox
      gap={4}
      paddingBlock={8}
      paddingInline={10}
      style={{
        borderInlineStart: `2px solid ${cssVar.colorBorderSecondary}`,
        width: '100%',
      }}
    >
      <Flexbox horizontal align={'center'} gap={6} wrap={'wrap'}>
        <Icon color={cssVar.colorTextTertiary} icon={Scale} size={13} />
        <Text fontSize={11} type={'secondary'}>
          {t('acceptance.dispute.title')} · {t(`acceptance.dispute.kind.${dispute.kind}`)}
        </Text>
        {dispute.kind === 'invalid_criterion' && (
          <Text
            fontSize={11}
            style={{
              color: arbitration ? OUTCOME_COLOR[arbitration.outcome] : cssVar.colorTextTertiary,
            }}
          >
            {arbitration
              ? t(`acceptance.dispute.outcome.${arbitration.outcome}`)
              : t('acceptance.dispute.outcome.pending')}
          </Text>
        )}
      </Flexbox>
      <FoldedText text={dispute.reason} />
      {arbitration && tally && votes.length > 0 && (
        <>
          <Flexbox
            horizontal
            align={'center'}
            aria-expanded={votesOpen}
            gap={2}
            role={'button'}
            style={{ color: cssVar.colorTextTertiary, cursor: 'pointer', width: 'fit-content' }}
            tabIndex={0}
            onClick={(event) => {
              event.stopPropagation();
              setVotesOpen((open) => !open);
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                setVotesOpen((open) => !open);
              }
            }}
          >
            <Icon
              icon={ChevronRight}
              size={12}
              style={{ transform: votesOpen ? 'rotate(90deg)' : 'none', transition: '0.2s' }}
            />
            <Text fontSize={11} type={'secondary'}>
              {t('acceptance.dispute.tally', { judged: tally.judged, upheld: tally.upheld })}
            </Text>
          </Flexbox>
          {votesOpen && (
            <Flexbox gap={6} paddingInline={'14px 0'}>
              {votes.map((vote, index) => (
                <Flexbox gap={2} key={`${vote.provider}/${vote.model}-${index}`}>
                  <Flexbox horizontal align={'center'} gap={4}>
                    {/* One baseline for the model and its ruling, so the two read as one line. */}
                    <Flexbox horizontal align={'baseline'} gap={6} wrap={'wrap'}>
                      <Text fontSize={12} weight={600}>
                        {vote.model}
                      </Text>
                      <Text
                        fontSize={12}
                        style={{
                          color:
                            vote.status === 'judged' && vote.upheld
                              ? cssVar.colorSuccess
                              : cssVar.colorTextTertiary,
                        }}
                      >
                        {t(voteLabelKey(vote))}
                      </Text>
                    </Flexbox>
                  </Flexbox>
                  {vote.reason && (
                    <Text fontSize={12} style={{ whiteSpace: 'pre-wrap' }} type={'secondary'}>
                      {vote.reason}
                    </Text>
                  )}
                </Flexbox>
              ))}
            </Flexbox>
          )}
        </>
      )}
    </Flexbox>
  );
});

DisputeNote.displayName = 'AcceptanceDisputeNote';

export default DisputeNote;
