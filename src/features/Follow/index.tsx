'use client';

import { SiDiscord, SiGithub, SiMedium, SiX } from '@icons-pack/react-simple-icons';
import { SOCIAL_URL } from '@lobechat/business-const';
import { ActionIcon, Flexbox } from '@lobehub/ui';
import { createStaticStyles, cssVar } from 'antd-style';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { GITHUB } from '@/const/url';

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
      <a href={GITHUB} rel="noreferrer" target="_blank">
        <ActionIcon
          className={styles.icon}
          icon={SiGithub as any}
          title={t('follow', { name: 'GitHub' })}
        />
      </a>
      <a href={SOCIAL_URL.x} rel="noreferrer" target="_blank">
        <ActionIcon className={styles.icon} icon={SiX as any} title={t('follow', { name: 'X' })} />
      </a>
      <a href={SOCIAL_URL.discord} rel="noreferrer" target="_blank">
        <ActionIcon
          className={styles.icon}
          icon={SiDiscord as any}
          title={t('follow', { name: 'Discord' })}
        />
      </a>
      <a href={SOCIAL_URL.medium} rel="noreferrer" target="_blank">
        <ActionIcon
          className={styles.icon}
          icon={SiMedium as any}
          title={t('follow', { name: 'Medium' })}
        />
      </a>
    </Flexbox>
  );
});

Follow.displayName = 'Follow';

export default Follow;
