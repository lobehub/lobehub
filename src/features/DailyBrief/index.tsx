import { Button, Flexbox } from '@lobehub/ui';
import { Newspaper } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';

import GroupBlock from '@/routes/(main)/home/features/components/GroupBlock';
import { useBriefStore } from '@/store/brief';
import { briefListSelectors } from '@/store/brief/selectors';
import { featureFlagsSelectors, useServerConfigStore } from '@/store/serverConfig';
import { useUserStore } from '@/store/user';
import { authSelectors } from '@/store/user/slices/auth/selectors';

import BriefCard from './BriefCard';

const DailyBrief = memo(() => {
  const { t } = useTranslation('home');
  const navigate = useNavigate();
  const isLogin = useUserStore(authSelectors.isLogin);
  const { enableAgentTask } = useServerConfigStore(featureFlagsSelectors);
  const useFetchBriefs = useBriefStore((s) => s.useFetchBriefs);
  useFetchBriefs(isLogin && !!enableAgentTask);

  const briefs = useBriefStore(briefListSelectors.briefs);
  const isInit = useBriefStore(briefListSelectors.isBriefsInit);

  if (!enableAgentTask) return null;
  if (!isInit || briefs.length === 0) return null;

  return (
    <GroupBlock
      actionAlwaysVisible
      icon={Newspaper}
      title={t('brief.title')}
      action={
        <Button size={'small'} type={'text'} onClick={() => navigate('/tasks')}>
          {t('brief.viewAllTasks')}
        </Button>
      }
    >
      <Flexbox gap={12}>
        {briefs.map((brief) => (
          <BriefCard brief={brief} key={brief.id} />
        ))}
      </Flexbox>
    </GroupBlock>
  );
});

export default DailyBrief;
