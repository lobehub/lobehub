'use client';

import { Flexbox, Hotkey } from '@lobehub/ui';
import { createStaticStyles } from 'antd-style';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useUserStore } from '@/store/user';
import { settingsSelectors } from '@/store/user/selectors';
import { HotkeyEnum } from '@/types/hotkey';

const styles = createStaticStyles(({ css, cssVar }) => ({
  closeButton: css`
    color: ${cssVar.colorTextSecondary};
    transition: color 0.2s;

    &:hover {
      color: ${cssVar.colorTextQuaternary};
    }
  `,

  container: css`
    position: fixed;
    z-index: 50;
    inset-block-start: 16px;
    inset-inline-start: 50%;
    transform: translateX(-50%);

    animation: fade-in-slide-down 300ms ease;

    @keyframes fade-in-slide-down {
      from {
        transform: translate(-50%, -16px);
        opacity: 0;
      }

      to {
        transform: translate(-50%, 0);
        opacity: 1;
      }
    }
  `,

  text: css`
    font-size: 16px;
    font-weight: 500;
    color: ${cssVar.colorBgBase};
  `,

  toast: css`
    display: flex;
    align-items: center;

    padding-block: 8px;
    padding-inline: 24px;
    border-radius: 9999px;

    background: ${cssVar.colorText};
    box-shadow: ${cssVar.boxShadowSecondary};
  `,
}));

const Toast = () => {
  const { t } = useTranslation('chat');
  const [isVisible, setIsVisible] = useState(true);
  const hotkey = useUserStore(settingsSelectors.getHotkeyById(HotkeyEnum.ToggleZenMode));

  useEffect(() => {
    const timer = setTimeout(() => {
      setIsVisible(false);
    }, 2000);

    return () => clearTimeout(timer);
  }, []);

  if (!isVisible) return null;

  return (
    <div className={styles.container}>
      <div className={styles.toast}>
        <Flexbox horizontal align={'center'} className={styles.text} gap={8}>
          {t('zenMode')} <Hotkey inverseTheme keys={hotkey} />
        </Flexbox>
      </div>
    </div>
  );
};

export default Toast;
