'use client';

import { SiDiscord, SiGithub, SiRss, SiX, SiYoutube } from '@icons-pack/react-simple-icons';
import { BRANDING_EMAIL, BRANDING_NAME, SOCIAL_URL } from '@lobechat/business-const';
import { createStaticStyles, Divider, Flexbox } from '@lobehub/ui';
import { Form } from '@lobehub/ui/form';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { BLOG, mailTo, OFFICIAL_SITE, PRIVACY_URL, TERMS_URL } from '@/const/url';
import { vendorLink } from '@/utils/vendorLink';

import AboutList from './AboutList';
import ItemCard from './ItemCard';
import ItemLink from './ItemLink';
import OssNoticeEntry from './OssNotice/OssNoticeEntry';
import Version from './Version';

const styles = createStaticStyles(({ css, cssVar }) => ({
  title: css`
    font-size: 14px;
    font-weight: bold;
    color: ${cssVar.colorTextSecondary};
  `,
}));

/**
 * These sections list the vendor's own channels — website, support mailbox,
 * social accounts, terms and privacy pages. A distribution that has none of
 * them leaves the corresponding constants empty, and rendering the headings
 * anyway produced a "Contact us" block whose links went nowhere, under a
 * product name that has no such channels. (It also passed `undefined` straight
 * into `mailTo`.)
 *
 * So build each list from whatever is actually configured, and drop a section
 * once nothing is left in it.
 */
interface AboutItem {
  href?: string;
  icon?: any;
  label: string;
  value: string;
}

type LinkedAboutItem = AboutItem & { href: string };

/**
 * `OFFICIAL_SITE` and everything urlJoin'd off it (blog, terms, privacy) are the
 * upstream vendor's own pages, hardcoded rather than branded. A rebranded
 * distribution does not inherit them: linking its users to another company's
 * terms of service is worse than showing no link, and repointing the constant at
 * the deployment's own domain only turns them into 404s on that domain, since
 * those paths do not exist there.
 *
 * So under custom branding these count as unconfigured, and the sections that
 * end up empty disappear like the rest.
 */
const withLinks = (items: AboutItem[]): LinkedAboutItem[] =>
  items.filter((item): item is LinkedAboutItem => !!item.href);

const About = memo<{ mobile?: boolean }>(({ mobile }) => {
  const { t } = useTranslation('common');

  // The open-source notice is a TITU Work (CPC) disclosure; other brandings do not show it.
  const showOssNotice = BRANDING_NAME === 'TITU Work';

  const contactItems = withLinks([
    { href: vendorLink(OFFICIAL_SITE), label: t('officialSite'), value: 'officialSite' },
    {
      href: BRANDING_EMAIL.support ? mailTo(BRANDING_EMAIL.support) : undefined,
      label: t('mail.support'),
      value: 'support',
    },
    {
      href: BRANDING_EMAIL.business ? mailTo(BRANDING_EMAIL.business) : undefined,
      label: t('mail.business'),
      value: 'business',
    },
  ]);

  const informationItems = withLinks([
    { href: vendorLink(BLOG), icon: SiRss, label: t('blog'), value: 'blog' },
    { href: SOCIAL_URL.github, icon: SiGithub, label: 'GitHub', value: 'feedback' },
    { href: SOCIAL_URL.discord, icon: SiDiscord, label: 'Discord', value: 'discord' },
    { href: SOCIAL_URL.x, icon: SiX as any, label: 'X / Twitter', value: 'x' },
    { href: SOCIAL_URL.youtube, icon: SiYoutube, label: 'YouTube', value: 'youtube' },
  ]);

  const legalItems = withLinks([
    { href: vendorLink(TERMS_URL), label: t('terms'), value: 'terms' },
    { href: vendorLink(PRIVACY_URL), label: t('privacy'), value: 'privacy' },
  ]);

  return (
    <Form.Group
      collapsible={false}
      style={{ maxWidth: '1024px', width: '100%' }}
      title={`${t('about')} ${BRANDING_NAME}`}
      variant={'filled'}
    >
      <Flexbox gap={20} paddingBlock={20} width={'100%'}>
        <Version mobile={mobile} />
        {contactItems.length > 0 && (
          <>
            <Divider style={{ marginBlock: 0 }} />
            <div className={styles.title}>{t('contact')}</div>
            <AboutList ItemRender={ItemLink} items={contactItems} />
          </>
        )}
        {informationItems.length > 0 && (
          <>
            <Divider style={{ marginBlock: 0 }} />
            <div className={styles.title}>{t('information')}</div>
            <AboutList grid ItemRender={ItemCard} items={informationItems} />
          </>
        )}
        {(legalItems.length > 0 || showOssNotice) && (
          <>
            <Divider style={{ marginBlock: 0 }} />
            <div className={styles.title}>{t('legal')}</div>
            <Flexbox horizontal align={'center'} gap={24} wrap={'wrap'}>
              {legalItems.length > 0 && <AboutList ItemRender={ItemLink} items={legalItems} />}
              {showOssNotice && <OssNoticeEntry />}
            </Flexbox>
          </>
        )}
      </Flexbox>
    </Form.Group>
  );
});

export default About;
