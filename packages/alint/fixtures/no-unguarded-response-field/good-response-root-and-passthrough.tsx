// Fixture: a response that is itself the array, and a field handed to an imported helper.
import { memo } from 'react';

import { useClientDataSWR } from '@/libs/swr';
import { agentEvalService } from '@/services/agentEval';
import { deviceService } from '@/services/device';

import { partitionScan } from './partitionScan';

const ResumeSummary = memo<{ deviceId: string; runId: string }>(({ deviceId, runId }) => {
  const { data: cases } = useClientDataSWR(['resumable', runId], () =>
    agentEvalService.getResumableCases(runId),
  );
  const { data: scan } = useClientDataSWR(['scan', deviceId], () =>
    deviceService.scanAgents(deviceId),
  );

  if (!cases || !scan) return null;

  const resumable = cases.filter((item) => item.canResume);
  const { installed } = partitionScan(scan.agents);

  return (
    <span>
      {resumable.length} / {installed.length}
    </span>
  );
});

export default ResumeSummary;
