import { Icon } from '@lobehub/ui';
import { Button } from '@lobehub/ui/base-ui';
import { createStaticStyles } from 'antd-style';
import { SlidersHorizontal } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { openHomeCustomizeModal } from './CustomizeModal';

const styles = createStaticStyles(({ css }) => ({
  // Floats in the page corner where the portrait can stand behind it — frost
  // what shows through, like the rail cards do.
  glass: css`
    backdrop-filter: saturate(150%) blur(12px);
  `,
  label: css`
    @media (width <= 1100px) {
      display: none;
    }
  `,
}));

const CustomizeButton = memo(() => {
  const { t } = useTranslation('home');
  const label = t('dashboard.customize.entry');

  return (
    <Button
      aria-label={label}
      className={styles.glass}
      icon={<Icon icon={SlidersHorizontal} size={14} />}
      shape={'round'}
      size={'small'}
      title={label}
      type={'fill'}
      onClick={() => openHomeCustomizeModal()}
    >
      <span className={styles.label}>{label}</span>
    </Button>
  );
});

export default CustomizeButton;
