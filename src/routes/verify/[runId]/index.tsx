'use client';

import { Flexbox } from '@lobehub/ui';

import { RouteMetaBridge } from '@/features/RouteMeta';
import ReportViewer from '@/features/Verify/ReportViewer';

/** Standalone verification-report page: `/verify/:runId`. */
const VerifyReportPage = () => (
  <Flexbox height={'100dvh'} style={{ overflow: 'auto' }} width={'100%'}>
    {/* Outside the main layout, so mount the route-meta bridge here to drive the tab title. */}
    <RouteMetaBridge />
    <ReportViewer />
  </Flexbox>
);

export default VerifyReportPage;
