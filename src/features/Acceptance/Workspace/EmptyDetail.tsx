'use client';

import { Center, Empty } from '@lobehub/ui';
import { Button } from '@lobehub/ui/base-ui';
import { ScrollText } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { useUserStore } from '@/store/user';
import { authSelectors } from '@/store/user/selectors';
import { buildAuthReturnUrl } from '@/utils/authReturnUrl';

/** Right-pane placeholder shown at `/acceptance` when no aggregate is selected yet. */
const AcceptanceEmptyDetail = memo(() => {
  const { t } = useTranslation(['verify', 'auth']);
  const isSignedOut = useUserStore(authSelectors.isLogin) === false;

  return (
    <Center height={'100%'} width={'100%'}>
      <Empty
        icon={ScrollText}
        description={t(
          isSignedOut
            ? 'acceptance.workspace.emptyDetail.signInDescription'
            : 'acceptance.workspace.emptyDetail.description',
        )}
        title={t(
          isSignedOut ? 'acceptance.workspace.title' : 'acceptance.workspace.emptyDetail.title',
        )}
      >
        {isSignedOut && (
          <Button href={buildAuthReturnUrl('signin', '/acceptance')} type={'primary'}>
            {t('auth:login')}
          </Button>
        )}
      </Empty>
    </Center>
  );
});

AcceptanceEmptyDetail.displayName = 'AcceptanceEmptyDetail';

export default AcceptanceEmptyDetail;
