'use client';

import { Flexbox, Icon } from '@lobehub/ui';
import { Button } from '@lobehub/ui/base-ui';
import { PlusIcon } from 'lucide-react';
import { type FC, useCallback } from 'react';
import { useTranslation } from 'react-i18next';

import { styles } from '../../styles';
import { openEnableModelsModal } from '../EnableModelsModal';

interface FooterProps {
  onOpenChange?: (open: boolean) => void;
}

export const Footer: FC<FooterProps> = ({ onOpenChange }) => {
  const { t } = useTranslation('components');

  const handleAddModel = useCallback(() => {
    onOpenChange?.(false);
    openEnableModelsModal();
  }, [onOpenChange]);

  return (
    <Flexbox className={styles.footer} padding={8}>
      <Button block icon={<Icon icon={PlusIcon} />} variant="filled" onClick={handleAddModel}>
        {t('ModelSwitchPanel.addModel.button')}
      </Button>
    </Flexbox>
  );
};
