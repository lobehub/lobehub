import { toast } from '@lobehub/ui';
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { linkManualPullRequest } from '@/features/TopicPullRequests/linkManualPullRequest';
import { useWorkStore, workActions, workSelectors } from '@/store/work';

export const usePullRequestLink = (topicId: string, identifier: string, url: string) => {
  const { t } = useTranslation('chat');
  const [linking, setLinking] = useState(false);
  const inFlight = useRef(false);
  const key = identifier.toLowerCase();

  workActions.useFetchTopicPullRequests({ topicId });
  const canLink = useWorkStore((state) => {
    const items = workSelectors.topicPullRequests(topicId)(state);
    return !!items && !items.some((item) => item.identifier.toLowerCase() === key);
  });

  const link = async () => {
    if (!canLink || inFlight.current) return;
    inFlight.current = true;
    setLinking(true);

    try {
      const name = await linkManualPullRequest(topicId, url);
      toast.success(t('workingPanel.overview.pr.linked', { name }));
    } catch {
      toast.error(t('workingPanel.overview.pr.linkFailed'));
    } finally {
      inFlight.current = false;
      setLinking(false);
    }
  };

  return { canLink, link, linking };
};
