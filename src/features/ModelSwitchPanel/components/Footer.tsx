import { Block, Flexbox, Icon } from '@lobehub/ui';
import { cssVar } from 'antd-style';
import { LucideArrowRight, LucideBolt } from 'lucide-react';
import { type FC } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';

import { styles } from '../styles';

interface FooterProps {
  onClose: () => void;
}

export const Footer: FC<FooterProps> = ({ onClose }) => {
  const { t } = useTranslation('components');
  const navigate = useNavigate();

  return (
    <Flexbox className={styles.footer} padding={4}>
      <Block
        clickable
        horizontal
        gap={8}
        paddingBlock={8}
        paddingInline={12}
        variant={'borderless'}
        onClick={() => {
          navigate('/settings/provider/all');
          onClose();
        }}
      >
        <Flexbox horizontal align={'center'} gap={8} style={{ flex: 1 }}>
          <Icon icon={LucideBolt} size={'small'} />
          {t('ModelSwitchPanel.manageProvider')}
        </Flexbox>
        <Icon color={cssVar.colorTextDescription} icon={LucideArrowRight} size={'small'} />
      </Block>
    </Flexbox>
  );
};
