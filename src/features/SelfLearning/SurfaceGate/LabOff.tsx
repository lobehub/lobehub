'use client';

import { Button, Empty, Flexbox } from '@lobehub/ui';
import { FlaskConicalIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';

/** Empty state for a review surface the user has not unlocked: points at the Labs switch. */
const LabOff = () => {
  const { t } = useTranslation('memory');
  const navigate = useWorkspaceAwareNavigate();
  return (
    <Flexbox align={'center'} flex={1} justify={'center'}>
      <Empty
        description={t('rules.labOff.description')}
        icon={FlaskConicalIcon}
        title={t('rules.labOff.title')}
      >
        <Button onClick={() => navigate('/settings/labs')}>{t('rules.labOff.open')}</Button>
      </Empty>
    </Flexbox>
  );
};

export default LabOff;
