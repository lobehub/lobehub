'use client';

import { Icon } from '@lobehub/ui';
import { Button } from '@lobehub/ui/base-ui';
import { BrainCircuit } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';

import SettingHeader from '@/routes/(main)/settings/features/SettingHeader';

import Memory from './features/Memory';

const Page = () => {
  const { t } = useTranslation('setting');
  const navigate = useNavigate();
  return (
    <>
      <SettingHeader
        title={t('tab.memory')}
        // Config and management live on separate surfaces — give this settings
        // page the entry to actually view / edit / clear memory that its copy
        // promises, instead of dead-ending at a toggle + slider.
        extra={
          <Button
            icon={<Icon icon={BrainCircuit} />}
            size={'small'}
            onClick={() => navigate('/memory')}
          >
            {t('memory.manageEntry')}
          </Button>
        }
      />
      <Memory />
    </>
  );
};

export default Page;
