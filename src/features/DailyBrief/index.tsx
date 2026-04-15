import { Flexbox } from '@lobehub/ui';
import { Newspaper } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import GroupBlock from '@/routes/(main)/home/features/components/GroupBlock';
import { useBriefStore } from '@/store/brief';
import { briefListSelectors } from '@/store/brief/selectors';
import { useUserStore } from '@/store/user';
import { authSelectors } from '@/store/user/slices/auth/selectors';

import BriefCard from './BriefCard';

const DailyBrief = memo(() => {
  const { t } = useTranslation('home');
  const isLogin = useUserStore(authSelectors.isLogin);
  const useFetchBriefs = useBriefStore((s) => s.useFetchBriefs);
  useFetchBriefs(isLogin);

  const briefs = useBriefStore(briefListSelectors.briefs);
  const isInit = useBriefStore(briefListSelectors.isBriefsInit);

  if (!isInit || briefs.length === 0) return null;

  return (
    <GroupBlock icon={Newspaper} title={t('brief.title')}>
      <Flexbox gap={12}>
        {briefs.map((brief) => (
          <BriefCard brief={brief} key={brief.id} />
        ))}
      </Flexbox>
    </GroupBlock>
  );
});

export default DailyBrief;
