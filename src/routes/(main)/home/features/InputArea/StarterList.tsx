import { Jimeng } from '@lobehub/icons';
import { type ButtonProps } from '@lobehub/ui';
import { Button, Center, Tooltip } from '@lobehub/ui';
import { createStaticStyles, cssVar, cx } from 'antd-style';
import { ImageIcon } from 'lucide-react';
import { memo, useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { useStableNavigate } from '@/hooks/useStableNavigate';
import { type StarterMode } from '@/store/home';

const styles = createStaticStyles(({ css, cssVar }) => ({
  button: css`
    height: 40px;
    border-color: ${cssVar.colorFillSecondary};
    background: transparent;
    box-shadow: none !important;

    &:hover {
      border-color: ${cssVar.colorFillSecondary} !important;
      background: ${cssVar.colorBgElevated} !important;
    }
  `,
}));

type StarterTitleKey = 'starter.imageGeneration' | 'starter.videoGeneration';

interface StarterItem {
  disabled?: boolean;
  hot?: boolean;
  icon?: ButtonProps['icon'];
  key: StarterMode;
  titleKey: StarterTitleKey;
}

const StarterList = memo(() => {
  const { t } = useTranslation('home');
  const navigate = useStableNavigate();

  const items: StarterItem[] = useMemo(
    () => [
      {
        hot: true,
        icon: ImageIcon,
        key: 'image',
        titleKey: 'starter.imageGeneration',
      },
      {
        hot: true,
        icon: Jimeng.Color,
        key: 'video',
        titleKey: 'starter.videoGeneration',
      },
    ],
    [],
  );

  const handleClick = useCallback(
    (key: StarterMode) => {
      if (key === 'video') {
        navigate('/video?model=dreamina-seedance-2-0-260128');
        return;
      }

      if (key === 'image') {
        navigate('/image?model=gpt-image-2');
        return;
      }
    },
    [navigate],
  );

  return (
    <Center horizontal gap={8}>
      {items.map((item) => {
        const button = (
          <Button
            className={cx(styles.button)}
            disabled={item.disabled}
            icon={item.icon}
            key={item.key}
            shape={'round'}
            variant={'outlined'}
            iconProps={{
              color: cssVar.colorTextSecondary,
              size: 18,
            }}
            onClick={() => handleClick(item.key)}
          >
            {t(item.titleKey)}
            {item.hot && ' 🔥'}
          </Button>
        );

        if (item.disabled) {
          return (
            <Tooltip key={item.key} title={t('starter.developing')}>
              {button}
            </Tooltip>
          );
        }

        return button;
      })}
    </Center>
  );
});

export default StarterList;
