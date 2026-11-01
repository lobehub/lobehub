'use client';

import { createModal } from '@lobehub/ui';

import GoalSignOffReport, { type GoalSignOffReportProps } from './SignOffReport';

/**
 * Open a finished Goal's delivery for sign-off where the owner already is —
 * the same report-then-decide dialog a batch release gate opens, so a goal is
 * never closed from a bare yes/no.
 */
export const openGoalSignOffModal = (props: GoalSignOffReportProps) =>
  createModal({
    content: <GoalSignOffReport {...props} />,
    footer: null,
    maskClosable: true,
    // The report draws its own frame — header, scrolling body, action band.
    styles: { content: { overflow: 'hidden', padding: 0 }, header: { display: 'none' } },
    width: 'min(94vw, 960px)',
  });
