'use client';

import { ORG_NAME, UTM_SOURCE } from '@lobechat/business-const';
import { type FlexboxProps } from '@lobehub/ui';
import { Flexbox } from '@lobehub/ui';
import { LobeHub } from '@lobehub/ui/brand';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { memo } from 'react';

import { OFFICIAL_SITE } from '@/const/url';
import { isCustomORG } from '@/const/version';

const styles = stylex.create({
  logoLink: { lineHeight: 1, color: { 'default': 'inherit', ':hover': cssVar.colorLink } },
});

const BrandWatermark = memo<Omit<FlexboxProps, 'children'>>(({ style, ...rest }) => {
  return (
    <Flexbox
      horizontal
      align={'center'}
      dir={'ltr'}
      flex={'none'}
      gap={4}
      style={{ color: cssVar.colorTextDescription, fontSize: 12, ...style }}
      {...rest}
    >
      <span>Powered by</span>
      {isCustomORG ? (
        <span>{ORG_NAME}</span>
      ) : (
        <a
          {...stylex.props(styles.logoLink)}
          href={`${OFFICIAL_SITE}?utm_source=${UTM_SOURCE}&utm_content=brand_watermark`}
          rel="noreferrer"
          target="_blank"
        >
          <LobeHub size={20} type={'text'} />
        </a>
      )}
    </Flexbox>
  );
});

export default BrandWatermark;
