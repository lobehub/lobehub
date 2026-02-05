'use client';

import { SiDiscord, SiGithub, SiRss, SiX, SiYoutube } from '@icons-pack/react-simple-icons';
import { BRANDING_EMAIL, BRANDING_NAME, SOCIAL_URL } from '@lobechat/business-const';
import { Flexbox, Form } from '@lobehub/ui';
import { Divider } from 'antd';
import { createStaticStyles } from 'antd-style';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { BLOG, mailTo,OFFICIAL_SITE, PRIVACY_URL, TERMS_URL } from '@/const/url';

import AboutList from './AboutList';
import ItemCard from './ItemCard';
import ItemLink from './ItemLink';
import Version from './Version';

const styles = createStaticStyles(({ css, cssVar }) => ({
  title: css`
    font-size: 14px;
    font-weight: bold;
    color: ${cssVar.colorTextSecondary};
  `,
}));

const About = memo<{ mobile?: boolean }>(({ mobile }) => {
  const { t } = useTranslation('common');

  return (
    <Form.Group
      collapsible={false}
      gap={16}
      style={{ maxWidth: '1024px', width: '100%' }}
      title={`${t('about')} ${BRANDING_NAME}`}
      variant={'filled'}
    >
      <Flexbox gap={20} paddingBlock={20} width={'100%'}>
        <div className={styles.title}>{t('version')}</div>
        <Version mobile={mobile} />
        <Divider style={{ marginBlock: 0 }} />
        <div className={styles.title}>{t('contact')}</div>
        <AboutList
          ItemRender={ItemLink}
          items={[
            {
              href: OFFICIAL_SITE,
              label: t('officialSite'),
              value: 'officialSite',
            },
            {
              href: mailTo(BRANDING_EMAIL.support),
              label: t('mail.support'),
              value: 'support',
            },
            {
              href: mailTo(BRANDING_EMAIL.business),
              label: t('mail.business'),
              value: 'business',
            },
          ]}
        />
        <Divider style={{ marginBlock: 0 }} />
        <div className={styles.title}>{t('information')}</div>
        <AboutList
          grid
          ItemRender={ItemCard}
          items={[
            {
              href: BLOG,
              icon: SiRss,
              label: t('blog'),
              value: 'blog',
            },
            {
              href: SOCIAL_URL.github,
              icon: SiGithub,
              label: 'GitHub',
              value: 'feedback',
            },
            {
              href: SOCIAL_URL.discord,
              icon: SiDiscord,
              label: 'Discord',
              value: 'discord',
            },
            {
              href: SOCIAL_URL.x,
              icon: SiX as any,
              label: 'X / Twitter',
              value: 'x',
            },

            {
              href: SOCIAL_URL.youtube,
              icon: SiYoutube,
              label: 'YouTube',
              value: 'youtube',
            },
          ]}
        />
        <Divider style={{ marginBlock: 0 }} />
        <div className={styles.title}>{t('legal')}</div>
        <AboutList
          ItemRender={ItemLink}
          items={[
            {
              href: TERMS_URL,
              label: t('terms'),
              value: 'terms',
            },
            {
              href: PRIVACY_URL,
              label: t('privacy'),
              value: 'privacy',
            },
          ]}
        />
      </Flexbox>
    </Form.Group>
  );
});

export default About;
