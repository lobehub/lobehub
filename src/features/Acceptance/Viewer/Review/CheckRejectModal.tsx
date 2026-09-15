'use client';

import { Flexbox } from '@lobehub/ui';
import { createModal, Text } from '@lobehub/ui/base-ui';
import { useResponsive } from 'antd-style';
import { memo } from 'react';

import { DesktopEvidenceReview } from '../Evidence/DesktopEvidenceReview';
import { MobileEvidenceReview } from '../Evidence/MobileEvidenceReview';
import { checkRejectModalShell, rejectModalTitle } from './rejectModalShell';
import type { RejectReviewInput } from './useRejectReview';
import { useRejectReview } from './useRejectReview';

export type { RejectableEvidence } from './rejectDraft';

interface CheckRejectModalProps extends RejectReviewInput {
  checkDescription?: string;
  checkTitle: string;
}

/**
 * The reject's state lives here; where it goes on screen does not.
 *
 * The phone and the desktop lay this out differently enough to be separate
 * files, but they are the same review: one draft, one set of regions, one
 * submit rule. This is the single place that picks between them.
 */
export const CheckRejectModalContent = memo<CheckRejectModalProps>(
  ({ checkDescription: _checkDescription, checkTitle, ...input }) => {
    const { md = true } = useResponsive();
    const model = useRejectReview(input);

    return md ? (
      <DesktopEvidenceReview checkTitle={checkTitle} model={model} />
    ) : (
      <MobileEvidenceReview model={model} />
    );
  },
);

CheckRejectModalContent.displayName = 'AcceptanceCheckRejectModalContent';

/** Per-check reject modal — media gets a near-fullscreen annotation surface without losing context. */
export const openCheckRejectModal = (options: CheckRejectModalProps) => {
  const modalTitle = rejectModalTitle(options.checkTitle, options.checkDescription);
  const shell = checkRejectModalShell(options.evidence.length);

  return createModal({
    ...shell,
    content: <CheckRejectModalContent {...options} />,
    footer: null,
    maskClosable: true,
    title: (
      <Flexbox gap={2}>
        <Text strong style={{ overflowWrap: 'anywhere', whiteSpace: 'normal' }}>
          {modalTitle.title}
        </Text>
        {modalTitle.description && (
          <Text fontSize={12} type={'secondary'}>
            {modalTitle.description}
          </Text>
        )}
      </Flexbox>
    ),
  });
};
