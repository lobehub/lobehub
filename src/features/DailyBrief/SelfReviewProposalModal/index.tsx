'use client';

import { type SelfReviewProposalContentItem } from '@lobechat/agent-signal/brief';
import { createModal } from '@lobehub/ui';
import { t } from 'i18next';
import { lazy, Suspense } from 'react';

// Markdown rendering stays out of the home bundle until a reader opens details.
const ProposalContent = lazy(() =>
  import('./ProposalContent').then((module) => ({ default: module.ProposalContent })),
);

/**
 * Opens the full content of a nightly self-review proposal — skill bodies,
 * replacement system prompt, memory text — so the user can read what they are
 * about to approve.
 */
export const createSelfReviewProposalModal = (items: SelfReviewProposalContentItem[]) =>
  createModal({
    content: (
      <Suspense fallback={<div style={{ minHeight: 200 }} />}>
        <ProposalContent items={items} />
      </Suspense>
    ),
    footer: null,
    maskClosable: true,
    styles: { content: { padding: 0 } },
    title: t('brief.agentSignal.selfReview.detail.title', { ns: 'home' }),
    width: 'min(90%, 760px)',
  });
