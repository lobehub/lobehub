import { BRANDING_NAME } from '@lobechat/business-const';
import { Flexbox, Skeleton } from '@lobehub/ui';
import { Clock3Icon, ClockArrowUp } from 'lucide-react';
import { memo } from 'react';
import { Trans, useTranslation } from 'react-i18next';

import { useClientDataSWR } from '@/libs/swr';
import { userService } from '@/services/user';
import { useUserStore } from '@/store/user';
import { userProfileSelectors } from '@/store/user/selectors';
import { formatIntergerNumber } from '@/utils/format';

import TimeLabel from '../components/TimeLabel';

const formatEnglishNumber = (number: number) => {
  if (number === 1) return '1st';
  if (number === 2) return '2nd';
  if (number === 3) return '3rd';
  return `${formatIntergerNumber(number)}th`;
};

const Welcome = memo<{ mobile?: boolean }>(({ mobile }) => {
  const { t, i18n } = useTranslation('auth');
  const [nickname, username] = useUserStore((s) => [
    userProfileSelectors.nickName(s),
    userProfileSelectors.username(s),
  ]);

  const { data, isLoading } = useClientDataSWR('welcome', async () =>
    userService.getUserRegistrationDuration(),
  );

  return (
    <Flexbox padding={mobile ? 16 : 0}>
      <Flexbox
        horizontal
        align={'center'}
        gap={8}
        style={{
          fontSize: 16,
          fontWeight: 500,
        }}
      >
        <Trans
          i18nKey="stats.welcome"
          ns={'auth'}
          components={{
            span:
              isLoading || !data ? (
                <Skeleton.Button active style={{ height: 24, minWidth: 40, width: 40 }} />
              ) : (
                <span style={{ fontWeight: 'bold' }} />
              ),
          }}
          values={{
            appName: BRANDING_NAME,
            days:
              i18n.language === 'en-US'
                ? formatEnglishNumber(Number(data?.duration || 1))
                : formatIntergerNumber(Number(data?.duration || 1)),
            username: nickname || username,
          }}
        />
      </Flexbox>
      <Flexbox horizontal gap={16} wrap={'wrap'}>
        <TimeLabel date={data?.createdAt} icon={Clock3Icon} title={t('stats.createdAt')} />
        <TimeLabel date={data?.updatedAt} icon={ClockArrowUp} title={t('stats.updatedAt')} />
      </Flexbox>
    </Flexbox>
  );
});

export default Welcome;
