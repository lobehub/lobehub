'use client';

import { createModal, Flexbox, useResponsive } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { DesktopEvidenceReview } from '../Evidence/DesktopEvidenceReview';
import { MobileEvidenceReview } from '../Evidence/MobileEvidenceReview';
import { checkRejectModalShell, rejectModalHeading, rejectModalTitle } from './rejectModalShell';
import type { RejectReviewInput } from './useRejectReview';
import { useRejectReview } from './useRejectReview';

export type { RejectableEvidence } from './rejectDraft';

const styles = stylex.create({
  heading: {
    overflow: 'hidden',
    display: 'flex',
    gap: '8px',
    alignItems: 'baseline',
    minWidth: 0,
    maxWidth: '100%',
    fontSize: '14px',
    lineHeight: '22px',
  },
  code: {
    flex: 'none',
    fontFamily: cssVar.fontFamilyCode,
    fontSize: '12px',
    fontWeight: 400,
    color: cssVar.colorTextSecondary,
  },
  action: {
    flex: 'none',
    fontWeight: 600,
    color: cssVar.colorText,
  },
  phoneSubject: {
    fontSize: '14px',
    fontWeight: 400,
    lineHeight: '22px',
    color: cssVar.colorTextSecondary,
    overflowWrap: 'anywhere',
    whiteSpace: 'normal',
  },
  subject: {
    overflow: 'hidden',
    minWidth: 0,
    fontWeight: 400,
    color: cssVar.colorTextSecondary,
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
});

interface CheckRejectModalProps extends RejectReviewInput {
  checkDescription?: string;
  checkTitle: string;
}

const CheckRejectModalTitle = memo<Pick<CheckRejectModalProps, 'checkDescription' | 'checkTitle'>>(
  ({ checkDescription, checkTitle }) => {
    const { t } = useTranslation('verify');
    const { md = true } = useResponsive();
    const modalTitle = rejectModalTitle(checkTitle, checkDescription);

    const heading = rejectModalHeading(modalTitle.title);

    if (!md)
      return (
        <Flexbox gap={2}>
          <div {...stylex.props(styles.heading)}>
            {heading.code && <span {...stylex.props(styles.code)}>{heading.code}</span>}
            <span {...stylex.props(styles.action)}>{t('acceptance.review.reject')}</span>
          </div>
          <span {...stylex.props(styles.phoneSubject)}>{heading.title}</span>
        </Flexbox>
      );

    return (
      <div {...stylex.props(styles.heading)}>
        {heading.code && <span {...stylex.props(styles.code)}>{heading.code}</span>}
        <span {...stylex.props(styles.action)}>{t('acceptance.review.reject')}</span>
        <span {...stylex.props(styles.subject)} title={modalTitle.description ?? heading.title}>
          {heading.title}
        </span>
      </div>
    );
  },
);

CheckRejectModalTitle.displayName = 'AcceptanceCheckRejectModalTitle';

/**
 * The reject's state lives here; where it goes on screen does not.
 *
 * The phone and the desktop lay this out differently enough to be separate
 * files, but they are the same review: one draft, one set of regions, one
 * submit rule. This is the single place that picks between them.
 */
export const CheckRejectModalContent = memo<CheckRejectModalProps>(
  ({ checkDescription: _checkDescription, checkTitle: _checkTitle, ...input }) => {
    const { md = true } = useResponsive();
    // Frame-anchored notes need the desktop stage (keys, a timeline wide
    // enough to scrub); on a phone the video still plays inline in the row.
    const model = useRejectReview(
      md
        ? input
        : {
            ...input,
            evidence: input.evidence.filter((item) => item.type !== 'video'),
            keptEvidence: input.evidence.filter((item) => item.type === 'video'),
          },
    );

    return md ? <DesktopEvidenceReview model={model} /> : <MobileEvidenceReview model={model} />;
  },
);

CheckRejectModalContent.displayName = 'AcceptanceCheckRejectModalContent';

/** Per-check reject modal — media gets a near-fullscreen annotation surface without losing context. */
export const openCheckRejectModal = (options: CheckRejectModalProps) => {
  const shell = checkRejectModalShell(options.evidence.length);

  return createModal({
    ...shell,
    content: <CheckRejectModalContent {...options} />,
    footer: null,
    maskClosable: true,
    title: (
      <CheckRejectModalTitle
        checkDescription={options.checkDescription}
        checkTitle={options.checkTitle}
      />
    ),
  });
};
