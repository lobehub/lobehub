'use client';

import { LOBE_CHAT_CLOUD, UTM_SOURCE } from '@lobechat/business-const';
import { Button, Center, Flexbox, Icon } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { useSize } from 'ahooks';
import { ArrowRightIcon } from 'lucide-react';
import { memo, useEffect, useRef, useState } from 'react';
import Marquee from 'react-fast-marquee';
import { useTranslation } from 'react-i18next';

import { OFFICIAL_URL } from '@/const/url';
import { useIsDark } from '@/hooks/useIsDark';
import { isOnServerSide } from '@/utils/env';

export const BANNER_HEIGHT = 40;

const gradient = stylex.keyframes({
  '0%': { backgroundPosition: '0% 50%' },
  '50%': { backgroundPosition: '100% 50%' },
  '100%': { backgroundPosition: '0% 50%' },
});

const styles = stylex.create({
  background: {
    animationDelay: '5s',
    animationDuration: '5s',
    animationIterationCount: 'infinite',
    animationName: gradient,
    animationTimingFunction: 'ease',
    backgroundImage: `linear-gradient(-45deg, ${cssVar.gold}, ${cssVar.magenta}, ${cssVar.geekblue}, ${cssVar.cyan})`,
    backgroundSize: '400% 400%',
    borderRadius: 'inherit',
    filter: 'blur(60px)',
    height: '100%',
    opacity: 0.8,
    position: 'absolute',
    width: 'max(64%, 1280px)',
  },
  containerDark: {
    backgroundColor: cssVar.colorFill,
    overflow: 'hidden',
    position: 'relative',
  },
  containerLight: {
    backgroundColor: cssVar.colorFillSecondary,
    overflow: 'hidden',
    position: 'relative',
  },
  wrapper: {
    maxWidth: '100%',
    overflow: 'hidden',
    zIndex: 1,
  },
});

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
      className={stylex.props(isDarkMode ? styles.containerDark : styles.containerLight).className}
      flex={'none'}
      height={BANNER_HEIGHT}
      paddingInline={16}
      ref={ref}
      width={'100%'}
    >
      <div {...stylex.props(styles.background)} />
      <Center horizontal className={stylex.props(styles.wrapper).className} gap={16} width={'100%'}>
        {isTruncated ? <Marquee pauseOnHover>{content}</Marquee> : content}
        <a
          href={`${OFFICIAL_URL}?utm_source=${UTM_SOURCE}&utm_medium=banner`}
          rel="noreferrer"
          target="_blank"
        >
          <Button size={'small'} type="primary">
            {t('alert.cloud.action')} <Icon icon={ArrowRightIcon} />
          </Button>
        </a>
      </Center>
    </Center>
  );
});

export default CloudBanner;
