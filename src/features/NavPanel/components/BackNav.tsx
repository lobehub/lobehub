import { ActionIcon, Button, Flexbox } from '@lobehub/ui';
import { createStaticStyles } from 'antd-style';
import { ChevronLeftIcon } from 'lucide-react';
import { type PropsWithChildren } from 'react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';

import { DESKTOP_HEADER_ICON_SIZE } from '@/const/layoutTokens';

import ToggleLeftPanelButton from '../ToggleLeftPanelButton';

const styles = createStaticStyles(({ css, cssVar }) => ({
  button: css`
    height: 32px;
    padding-inline-start: 4px;
    font-size: 13px;
    color: ${cssVar.colorTextSecondary};

    &:hover {
      color: ${cssVar.colorText};
    }
  `,
}));

const BackNav = memo<PropsWithChildren>(({ children }) => {
  const navigate = useNavigate();
  const { t } = useTranslation('common');
  let leftContent;
  if (!children) {
    leftContent = (
      <Button
        className={styles.button}
        icon={ChevronLeftIcon}
        type={'text'}
        onClick={() => navigate('/')}
      >
        {t('back')}
      </Button>
    );
  } else {
    leftContent = (
      <Flexbox horizontal align={'center'} gap={4}>
        <ActionIcon
          icon={ChevronLeftIcon}
          size={DESKTOP_HEADER_ICON_SIZE}
          onClick={() => navigate('/')}
        />
        {children}
      </Flexbox>
    );
  }
  return (
    <Flexbox horizontal align={'center'} gap={4} justify={'space-between'} padding={8}>
      {leftContent}
      <ToggleLeftPanelButton />
    </Flexbox>
  );
});

export default BackNav;
