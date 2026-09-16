'use client';

import { Flexbox } from '@lobehub/ui';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import AsyncBoundary from '@/components/AsyncBoundary';
import { quickNoteSelectors, useQuickNoteStore } from '@/store/quickNote';

import Comments from './Comments';
import ProposalCard from './ProposalCard';
import RelatedResources from './RelatedResources';
import SectionLabel from './SectionLabel';
import { styles } from './style';

const AgenticSections = memo<{ noteId: string }>(({ noteId }) => {
  const { t } = useTranslation('note');
  const details = useQuickNoteStore(quickNoteSelectors.agenticDetailsById(noteId));
  const pendingProposals = useQuickNoteStore(quickNoteSelectors.pendingProposalsById(noteId));
  const useFetchAgenticDetails = useQuickNoteStore((s) => s.useFetchAgenticDetails);
  const { data, error, isLoading, mutate } = useFetchAgenticDetails(noteId);

  const resources = data?.resources ?? details?.resources ?? [];
  const comments = data?.comments ?? details?.comments ?? [];

  return (
    <AsyncBoundary
      data={data ?? details}
      error={error}
      errorVariant={'inline'}
      isLoading={isLoading}
      onRetry={() => void mutate()}
    >
      {pendingProposals.length > 0 && (
        <Flexbox className={styles.section} gap={8}>
          <SectionLabel
            count={t('ai.pendingCount', { count: pendingProposals.length })}
            title={t('agentic.proposal.title')}
          />
          <Flexbox gap={8}>
            {pendingProposals.map((proposal) => (
              <ProposalCard key={proposal.id} noteId={noteId} proposal={proposal} />
            ))}
          </Flexbox>
        </Flexbox>
      )}

      {resources.length > 0 && (
        <Flexbox className={styles.section} gap={8}>
          <RelatedResources resources={resources} />
        </Flexbox>
      )}

      {comments.length > 0 && (
        <Flexbox className={styles.section} gap={8}>
          <Comments comments={comments} noteId={noteId} />
        </Flexbox>
      )}
    </AsyncBoundary>
  );
});

AgenticSections.displayName = 'QuickNoteAgenticSections';

export default AgenticSections;
