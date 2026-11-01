// Fixture: a local Electron bridge payload, not a server response.
import { memo, useEffect, useState } from 'react';

import { electronDevtoolsService } from '@/services/electron/devtools';

type Metrics = Awaited<ReturnType<typeof electronDevtoolsService.getAppProcessMetrics>>;

const ProcessCount = memo(() => {
  const [metrics, setMetrics] = useState<Metrics | null>(null);

  useEffect(() => {
    void electronDevtoolsService.getAppProcessMetrics().then(setMetrics);
  }, []);

  if (!metrics) return null;

  return <span>{metrics.processes.length} processes</span>;
});

export default ProcessCount;
