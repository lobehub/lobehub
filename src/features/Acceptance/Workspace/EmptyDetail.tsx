'use client';

import { Center, Empty } from '@lobehub/ui';
import { ScrollText } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

/** Right-pane placeholder shown at `/acceptance` when no aggregate is selected yet. */
const AcceptanceEmptyDetail = memo(() => {
  const { t } = useTranslation('verify');
  return (
    <Center height={'100%'} width={'100%'}>
      <Empty
        description={t('acceptance.workspace.emptyDetail.description')}
        icon={ScrollText}
        title={t('acceptance.workspace.emptyDetail.title')}
      />
    </Center>
  );
});

AcceptanceEmptyDetail.displayName = 'AcceptanceEmptyDetail';

export default AcceptanceEmptyDetail;
