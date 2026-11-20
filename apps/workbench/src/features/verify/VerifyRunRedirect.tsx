'use client';

import { useEffect } from 'react';
import { useLocation, useParams } from 'react-router';
import useSWR from 'swr';

import { buildAcceptanceRoundPath } from '@/features/Acceptance/roundLink';
import { extractUuid } from '@/features/Acceptance/utils';
import { verifyKeys } from '@/libs/swr/keys';
import { verifyService } from '@/services/verify';

import WorkbenchLoading from '../../shell/WorkbenchLoading';
import { VerifyReportUnavailable } from './VerifyReportUnavailable';

/**
 * Client-rendered `/verify/:runId` (the self-hosted build, which has no
 * loader): resolve the run's acceptance round and leave for it. A full
 * navigation, not a router push, because the host decides which app serves
 * `/acceptance/:id`.
 */
export const VerifyRunRedirect = () => {
  const params = useParams<{ runId: string }>();
  const runId = extractUuid(params.runId);
  const { search } = useLocation();
  const { data, error, isLoading } = useSWR(
    runId ? verifyKeys.runAcceptanceRound(runId) : null,
    () => verifyService.getRunAcceptanceRound(runId!),
    { revalidateOnFocus: false, revalidateOnReconnect: false },
  );
  const target = buildAcceptanceRoundPath(data, search);

  useEffect(() => {
    if (target) window.location.replace(target);
  }, [target]);

  // Let the route's error boundary offer a retry instead of claiming the report is gone.
  if (error) throw error;
  if (isLoading || target) return <WorkbenchLoading />;

  return <VerifyReportUnavailable />;
};
