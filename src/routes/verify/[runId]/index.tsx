'use client';

import { Flexbox } from '@lobehub/ui';

import ReportViewer from '@/features/Verify/ReportViewer';

/** Standalone verification-report page: `/verify/:runId`. */
const VerifyReportPage = () => (
  <Flexbox height={'100dvh'} style={{ overflow: 'auto' }} width={'100%'}>
    <ReportViewer />
  </Flexbox>
);

export default VerifyReportPage;
