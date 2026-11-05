'use client';

import { CopyButton, cx, Flexbox, Skeleton } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { lineEllipsis, shinyTextStyles } from '@/styles';

const styles = stylex.create({
  cardBody: {
    paddingBlockStart: '12px',
    paddingInline: '12px',
  },
  container: {
    overflow: 'hidden',
    justifyContent: 'space-between',
    minWidth: '360px',
    maxWidth: '360px',
    height: '136px',
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: cssVar.colorBorderSecondary,
    borderRadius: '12px',
  },
  footer: {
    paddingBlock: '8px',
    paddingInline: '12px',
    fontSize: cssVar.fontSizeSM,
    color: cssVar.colorTextTertiary,
    backgroundColor: cssVar.colorFillQuaternary,
  },
});

const textClassName = cx(lineEllipsis(2), shinyTextStyles.shinyText);

const LoadingCard = memo<{ url: string }>(({ url }) => {
  const { t } = useTranslation('plugin');

  return (
    <Flexbox className={stylex.props(styles.container).className}>
      <Flexbox
        horizontal
        className={stylex.props(styles.cardBody).className}
        justify={'space-between'}
      >
        <a href={url} rel={'nofollow'} target={'_blank'}>
          <div className={textClassName}>{url}</div>
        </a>
        <CopyButton content={url} size={'small'} />
      </Flexbox>
      <Flexbox gap={4} paddingInline={16}>
        <Skeleton height={14} width={'95%'} />
        <Skeleton height={14} width={'40%'} />
      </Flexbox>

      <div {...stylex.props(styles.footer)}>{t('search.crawPages.crawling')}</div>
    </Flexbox>
  );
});

export default LoadingCard;
