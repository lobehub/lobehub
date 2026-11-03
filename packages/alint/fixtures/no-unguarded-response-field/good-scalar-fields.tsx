// Fixture: scalar response fields rendered and compared — undefined renders nothing.
import { memo } from 'react';

import { useClientDataSWR } from '@/libs/swr';
import { verifyService } from '@/services/verify';

const AcceptanceTitle = memo<{ acceptanceId: string }>(({ acceptanceId }) => {
  const { data } = useClientDataSWR(['acceptance-bundle', acceptanceId], () =>
    verifyService.getAcceptanceBundle(acceptanceId),
  );

  if (!data) return null;

  return (
    <h1>
      {data.acceptance.title}
      {data.acceptance.roundCount > 1 && <small> · {data.acceptance.roundCount}</small>}
    </h1>
  );
});

export default AcceptanceTitle;
