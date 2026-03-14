'use client';

import { SiTelegram, SiX } from '@icons-pack/react-simple-icons';
import { SOCIAL_URL } from '@lobechat/business-const';
import { ActionIcon, Flexbox } from '@lobehub/ui';
import { createStaticStyles, cssVar } from 'antd-style';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

const styles = createStaticStyles(({ css }) => {
  return {
    icon: css`
      svg {
        fill: ${cssVar.colorTextDescription};
      }

      &:hover {
        svg {
          fill: ${cssVar.colorText};
        }
      }
    `,
  };
});

const Follow = memo(() => {
  const { t } = useTranslation('common');
  return (
    <Flexbox horizontal gap={8}>
      <a href={SOCIAL_URL.x} rel="noreferrer" target="_blank">
        <ActionIcon className={styles.icon} icon={SiX as any} title={t('follow', { name: 'X' })} />
      </a>
      <a href={SOCIAL_URL.telegram} rel="noreferrer" target="_blank">
        <ActionIcon
          className={styles.icon}
          icon={SiTelegram as any}
          title={t('follow', { name: 'Telegram' })}
        />
      </a>
    </Flexbox>
  );
});

Follow.displayName = 'Follow';

export default Follow;
