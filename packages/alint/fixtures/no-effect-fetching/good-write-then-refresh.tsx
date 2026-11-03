// Fixture: a write on open, then SWR revalidation of the result.
import { memo, useEffect, useState } from 'react';
import useSWR from 'swr';

import { topicService } from '@/services/topic';

const ShareStatus = memo<{ topicId: string }>(({ topicId }) => {
  const [failed, setFailed] = useState(false);
  const { data, mutate } = useSWR(['topic-share', topicId], () =>
    topicService.getShareInfo(topicId),
  );

  useEffect(() => {
    if (data?.visibility) return;
    topicService
      .enableSharing(topicId, 'private')
      .then(() => mutate())
      .catch(() => setFailed(true));
  }, [data?.visibility, mutate, topicId]);

  if (failed) return <span>Sharing failed</span>;
  return <span>{data?.visibility ?? 'private'}</span>;
});

export default ShareStatus;
