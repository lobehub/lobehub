import { ActionIcon, Button, Flexbox } from '@lobehub/ui';
import { createStaticStyles } from 'antd-style';
import { ChevronLeftIcon } from 'lucide-react';
import { type MouseEvent, type PropsWithChildren, type ReactNode, useCallback } from 'react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router-dom';

import { DESKTOP_HEADER_ICON_SIZE } from '@/const/layoutTokens';
import { isModifierClick } from '@/utils/navigation';

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

const BackLink = ({ children }: { children: ReactNode }) => {
  const navigate = useNavigate();
  const handleClick = useCallback(
    (e: MouseEvent) => {
      if (isModifierClick(e)) return;
      e.preventDefault();
      navigate('/');
    },
    [navigate],
  );

  return (
    <Link to="/" onClick={handleClick}>
      {children}
    </Link>
  );
};

const BackNav = memo<PropsWithChildren>(({ children }) => {
  const { t } = useTranslation('common');
  const leftContent = children ? (
    <Flexbox horizontal align={'center'} gap={4}>
      <BackLink>
        <ActionIcon icon={ChevronLeftIcon} size={DESKTOP_HEADER_ICON_SIZE} />
      </BackLink>
      {children}
    </Flexbox>
  ) : (
    <BackLink>
      <Button className={styles.button} icon={ChevronLeftIcon} type={'text'}>
        {t('back')}
      </Button>
    </BackLink>
  );

  return (
    <Flexbox horizontal align={'center'} gap={4} justify={'space-between'} padding={8}>
      {leftContent}
      <ToggleLeftPanelButton />
    </Flexbox>
  );
});

export default BackNav;
