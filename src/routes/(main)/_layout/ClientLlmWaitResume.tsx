import { memo } from 'react';

import { useClientLlmWaitResume } from '@/hooks/useClientLlmWaitResume';

/** Render-less: continues runs that wait for this client to run a local model. */
const ClientLlmWaitResume = memo(() => {
  useClientLlmWaitResume();
  return null;
});

ClientLlmWaitResume.displayName = 'ClientLlmWaitResume';

export default ClientLlmWaitResume;
