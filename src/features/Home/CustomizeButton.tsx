import { ActionIcon } from '@lobehub/ui/base-ui';
import { SlidersHorizontal } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { openHomeCustomizeModal } from './CustomizeModal';

const CustomizeButton = memo(() => {
  const { t } = useTranslation('home');
  const label = t('dashboard.customize.title');

  return (
    <ActionIcon
      aria-label={label}
      icon={SlidersHorizontal}
      size={'small'}
      title={label}
      variant={'borderless'}
      onClick={() => openHomeCustomizeModal()}
    />
  );
});

export default CustomizeButton;
