'use client';

import { Center, Empty } from '@lobehub/ui';
import { ClipboardCheck } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

/** Right-pane placeholder shown at `/verify` when no report is selected yet. */
const EmptyDetail = memo(() => {
  const { t } = useTranslation('verify');
  return (
    <Center height={'100%'} width={'100%'}>
      <Empty
        description={t('workspace.emptyDetail.description')}
        icon={ClipboardCheck}
        title={t('workspace.emptyDetail.title')}
      />
    </Center>
  );
});

EmptyDetail.displayName = 'EmptyDetail';

export default EmptyDetail;
