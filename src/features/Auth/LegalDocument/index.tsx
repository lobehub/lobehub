'use client';

import { BRANDING_EMAIL, BRANDING_NAME, ORG_NAME } from '@lobechat/business-const';
import { Flexbox, Text } from '@lobehub/ui';
import { createStaticStyles } from 'antd-style';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';

const styles = createStaticStyles(({ css, cssVar }) => ({
  back: css`
    display: inline-block;

    margin-block-end: 16px;

    font-size: 13px;
    color: ${cssVar.colorTextSecondary};
    text-decoration: none;

    &:hover {
      color: ${cssVar.colorPrimary};
      text-decoration: underline;
    }
  `,
  body: css`
    margin: 0;

    font-size: 14px;
    line-height: 1.7;
    color: ${cssVar.colorTextSecondary};
    white-space: pre-wrap;
  `,
  section: css`
    display: flex;
    flex-direction: column;
    gap: 8px;
  `,
  shell: css`
    overflow: auto;

    width: 100%;
    max-width: 720px;
    margin-inline: auto;
    padding-block-end: 24px;
  `,
  title: css`
    margin: 0;

    font-size: 24px;
    font-weight: 600;
    line-height: 1.3;
    color: ${cssVar.colorText};
  `,
  updated: css`
    margin: 0;
    font-size: 13px;
    color: ${cssVar.colorTextDescription};
  `,
}));

const TERMS_SECTIONS = [
  'acceptance',
  'service',
  'account',
  'acceptableUse',
  'content',
  'privacy',
  'disclaimer',
  'changes',
  'contact',
] as const;

const PRIVACY_SECTIONS = [
  'overview',
  'collect',
  'use',
  'share',
  'retention',
  'security',
  'rights',
  'changes',
  'contact',
] as const;

export type LegalDocumentKind = 'terms' | 'privacy';

interface LegalDocumentProps {
  kind: LegalDocumentKind;
}

const LegalDocument = memo<LegalDocumentProps>(({ kind }) => {
  const { t } = useTranslation('auth');
  const sections = kind === 'terms' ? TERMS_SECTIONS : PRIVACY_SECTIONS;
  const vars = {
    appName: BRANDING_NAME,
    orgName: ORG_NAME,
    supportEmail: BRANDING_EMAIL.support || undefined,
  };

  return (
    <Flexbox className={styles.shell} gap={24}>
      <div>
        <Link
          className={styles.back}
          to="/signin"
          onClick={(event) => {
            if (window.history.length > 1) {
              event.preventDefault();
              window.history.back();
            }
          }}
        >
          {t('legal.back')}
        </Link>
        <Flexbox gap={8}>
          <h1 className={styles.title}>{t(`legal.${kind}.title`, vars)}</h1>
          <p className={styles.updated}>{t(`legal.${kind}.updated`, vars)}</p>
        </Flexbox>
      </div>

      <Text className={styles.body}>{t(`legal.${kind}.intro`, vars)}</Text>

      {sections.map((section) => {
        const titleKey = `legal.${kind}.sections.${section}.title`;
        const bodyKey =
          section === 'contact' && vars.supportEmail
            ? `legal.${kind}.sections.contact.bodyWithEmail`
            : `legal.${kind}.sections.${section}.body`;

        return (
          <section className={styles.section} key={section}>
            <Text strong style={{ fontSize: 16 }}>
              {t(titleKey, vars)}
            </Text>
            <p className={styles.body}>{t(bodyKey, vars)}</p>
          </section>
        );
      })}
    </Flexbox>
  );
});

LegalDocument.displayName = 'LegalDocument';

export default LegalDocument;
