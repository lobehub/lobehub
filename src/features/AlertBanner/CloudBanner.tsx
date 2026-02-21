'use client';

import { LOBE_CHAT_CLOUD, UTM_SOURCE } from '@lobechat/business-const';
import { Button, Center, Flexbox, Icon, lobeStaticStylish } from '@lobehub/ui';
import { useSize } from 'ahooks';
import { createStaticStyles, cx } from 'antd-style';
import { ArrowRightIcon } from 'lucide-react';
import { memo, useEffect, useRef, useState } from 'react';
import Marquee from 'react-fast-marquee';
import { useTranslation } from 'react-i18next';

import { OFFICIAL_URL } from '@/const/url';
import { useIsDark } from '@/hooks/useIsDark';
import { isOnServerSide } from '@/utils/env';

export const BANNER_HEIGHT = 40;

const styles = createStaticStyles(({ css, cssVar }) => ({
  background: cx(
    lobeStaticStylish.gradientAnimation,
    css`
      position: absolute;

      width: max(64%, 1280px);
      height: 100%;

      opacity: 0.8;
      filter: blur(60px);
    `,
  ),
  containerDark: css`
    position: relative;
    overflow: hidden;
    background-color: ${cssVar.colorFill};
  `,
  containerLight: css`
    position: relative;
    overflow: hidden;
    background-color: ${cssVar.colorFillSecondary};
  `,
  wrapper: css`
    z-index: 1;
    overflow: hidden;
    max-width: 100%;
  `,
}));

const CloudBanner = memo<{ mobile?: boolean }>(({ mobile }) => {
  const ref = useRef(null);
  const contentRef = useRef(null);
  const size = useSize(ref);
  const contentSize = useSize(contentRef);
  const isDarkMode = useIsDark();
  const { t } = useTranslation('common');
  const [isTruncated, setIsTruncated] = useState(mobile);

  useEffect(() => {
    if (mobile || isOnServerSide || !size || !contentSize) return;
    setIsTruncated(contentSize.width > size.width - 120);
  }, [size, contentSize, mobile]);

  const content = (
    <Flexbox horizontal align={'center'} flex={'none'} gap={8} ref={contentRef}>
      <b>{t('alert.cloud.title', { name: LOBE_CHAT_CLOUD })}:</b>
      <span>
        {t(mobile ? 'alert.cloud.descOnMobile' : 'alert.cloud.desc', {
          credit: new Intl.NumberFormat('en-US').format(500_000),
          name: LOBE_CHAT_CLOUD,
        })}
      </span>
    </Flexbox>
  );
  return (
    <Center
      className={isDarkMode ? styles.containerDark : styles.containerLight}
      flex={'none'}
      height={BANNER_HEIGHT}
      paddingInline={16}
      ref={ref}
      width={'100%'}
    >
      <div className={styles.background} />
      <Center horizontal className={styles.wrapper} gap={16} width={'100%'}>
        {isTruncated ? <Marquee pauseOnHover>{content}</Marquee> : content}
        <a href={`${OFFICIAL_URL}?utm_source=${UTM_SOURCE}&utm_medium=banner`} rel="noreferrer" target="_blank">
          <Button size={'small'} type="primary">
            {t('alert.cloud.action')} <Icon icon={ArrowRightIcon} />
          </Button>
        </a>
      </Center>
    </Center>
  );
});

export default CloudBanner;
