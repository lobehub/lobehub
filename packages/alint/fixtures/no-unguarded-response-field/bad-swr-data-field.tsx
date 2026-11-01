// Fixture: a field of SWR data iterated after guarding only the payload root.
import { memo } from 'react';

import { useClientDataSWR } from '@/libs/swr';
import { verifyService } from '@/services/verify';

const RoundList = memo<{ acceptanceId: string }>(({ acceptanceId }) => {
  const { data } = useClientDataSWR(['acceptance-bundle', acceptanceId], () =>
    verifyService.getAcceptanceBundle(acceptanceId),
  );

  if (!data) return null;

  return (
    <ul>
      {/* alint-expect */}
      {data.rounds.map((round) => (
        <li key={round.id}>{round.summary}</li>
      ))}
    </ul>
  );
});

export default RoundList;
