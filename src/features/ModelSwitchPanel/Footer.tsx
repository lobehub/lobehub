import { Flexbox, Icon } from '@lobehub/ui';
import { LucideArrowRight, LucideSettings } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';

import { styles } from './styles';

interface FooterProps {
  onClose: () => void;
}

export const Footer = memo<FooterProps>(({ onClose }) => {
  const { t } = useTranslation('components');
  const navigate = useNavigate();

  return (
    <div className={styles.footer}>
      <div
        className={styles.footerButton}
        onClick={() => {
          navigate('/settings/provider/all');
          onClose();
        }}
      >
        <Flexbox align={'center'} gap={8} horizontal style={{ flex: 1 }}>
          <Icon icon={LucideSettings} size={16} />
          {t('ModelSwitchPanel.manageProvider')}
        </Flexbox>
        <Icon icon={LucideArrowRight} size={16} />
      </div>
    </div>
  );
});

Footer.displayName = 'Footer';
