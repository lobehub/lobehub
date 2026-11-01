'use client';

import { Accordion, Flexbox } from '@lobehub/ui';
import * as stylex from '@stylexjs/stylex';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import AsyncBoundary from '@/components/AsyncBoundary';
import { quickNoteSelectors, useQuickNoteStore } from '@/store/quickNote';

import Comments from './Comments';
import ExecutedSection from './ExecutedSection';
import ProposalCard from './ProposalCard';
import RelatedResources from './RelatedResources';
import SectionLabel from './SectionLabel';
import { styles } from './style';

const AgenticSections = memo<{ noteId: string }>(({ noteId }) => {
  const { t } = useTranslation('note');
  const details = useQuickNoteStore(quickNoteSelectors.agenticDetailsById(noteId));
  const actionableProposals = useQuickNoteStore(quickNoteSelectors.actionableProposalsById(noteId));
  const archivedProposals = useQuickNoteStore(quickNoteSelectors.archivedProposalsById(noteId));
  const useFetchAgenticDetails = useQuickNoteStore((s) => s.useFetchAgenticDetails);
  const { data, error, isLoading, mutate } = useFetchAgenticDetails(noteId);

  const resources = data?.resources ?? details?.resources ?? [];
  const comments = data?.comments ?? details?.comments ?? [];
  const proposals = data?.proposals ?? details?.proposals ?? [];

  return (
    <AsyncBoundary
      data={data ?? details}
      error={error}
      errorVariant={'inline'}
      isLoading={isLoading}
      onRetry={() => void mutate()}
    >
      {actionableProposals.length > 0 && (
        <Flexbox className={stylex.props(styles.section).className} gap={8}>
          <SectionLabel
            count={t('ai.pendingCount', { count: actionableProposals.length })}
            title={t('agentic.proposal.title')}
          />
          <Flexbox gap={8}>
            {actionableProposals.map((proposal) => (
              <ProposalCard key={proposal.id} noteId={noteId} proposal={proposal} />
            ))}
          </Flexbox>
        </Flexbox>
      )}

      <ExecutedSection noteId={noteId} proposals={proposals} />

      {resources.length > 0 && (
        <Flexbox className={stylex.props(styles.section).className} gap={8}>
          <RelatedResources resources={resources} />
        </Flexbox>
      )}

      {comments.length > 0 && (
        <Flexbox className={stylex.props(styles.section).className} gap={8}>
          <Comments comments={comments} noteId={noteId} />
        </Flexbox>
      )}

      {archivedProposals.length > 0 && (
        <Flexbox className={stylex.props(styles.section).className}>
          <Accordion
            items={[
              {
                children: (
                  <Flexbox gap={6} paddingBlock={'8px 0'}>
                    {archivedProposals.map((proposal) => (
                      <ProposalCard key={proposal.id} noteId={noteId} proposal={proposal} />
                    ))}
                  </Flexbox>
                ),
                key: 'history',
                title: (
                  <SectionLabel
                    count={archivedProposals.length}
                    title={t('agentic.proposal.history')}
                  />
                ),
              },
            ]}
          />
        </Flexbox>
      )}
    </AsyncBoundary>
  );
});

AgenticSections.displayName = 'QuickNoteAgenticSections';

export default AgenticSections;
