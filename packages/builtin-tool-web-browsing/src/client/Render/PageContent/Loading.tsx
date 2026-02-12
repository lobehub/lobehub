'use client';

import { CopyButton, Flexbox, Skeleton } from '@lobehub/ui';
import { createStaticStyles, cx } from 'antd-style';
import Link from 'next/link';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { lineEllipsis, shinyTextStyles } from '@/styles';

const styles = createStaticStyles(({ css, cssVar }) => {
  return {
    cardBody: css`
      padding-block-start: 12px;
      padding-inline: 12px;
    `,
    container: css`
      overflow: hidden;
      justify-content: space-between;

      min-width: 360px;
      max-width: 360px;
      height: 136px;
      border: 1px solid ${cssVar.colorBorderSecondary};
      border-radius: 12px;
    `,

    footer: css`
      padding-block: 8px;
      padding-inline: 12px;

      font-size: ${cssVar.fontSizeSM};
      color: ${cssVar.colorTextTertiary};

      background-color: ${cssVar.colorFillQuaternary};
    `,
    text: cx(lineEllipsis(2), shinyTextStyles.shinyText),
  };
});

const LoadingCard = memo<{ url: string }>(({ url }) => {
  const { t } = useTranslation('plugin');

  return (
    <Flexbox className={styles.container}>
      <Flexbox horizontal className={styles.cardBody} justify={'space-between'}>
        <Link href={url} rel={'nofollow'} target={'_blank'}>
          <div className={styles.text}>{url}</div>
        </Link>
        <CopyButton content={url} size={'small'} />
      </Flexbox>
      <Flexbox gap={4} paddingInline={16}>
        <Skeleton.Block active style={{ height: 14, width: '95%' }} />
        <Skeleton.Block active style={{ height: 14, width: '40%' }} />
      </Flexbox>

      <div className={styles.footer}>{t('search.crawPages.crawling')}</div>
    </Flexbox>
  );
});

export default LoadingCard;
