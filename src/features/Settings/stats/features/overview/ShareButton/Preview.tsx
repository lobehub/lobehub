import { imageUrl, OFFICIAL_URL } from '@lobechat/const';
import {
  Center,
  // oxlint-disable-next-line stylex-migration/no-emotion-styles -- AiHeatmaps legend/footer and every descendant's scrollbar get no className
  createStaticStyles,
  cx,
  Flexbox,
  Grid,
  lobeStaticStylish,
} from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import { media } from '@lobehub/ui/stylex/media.stylex';
import * as stylex from '@stylexjs/stylex';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { ProductLogo } from '@/components/Branding';
import UserAvatar from '@/features/User/UserAvatar';
import { sx } from '@/styles/sx';

import AiHeatmaps from '../../visualization/AiHeatmaps';
import TotalMessages from '../TotalMessages';
import TotalTokens from '../TotalTokens';

const styles = stylex.create({
  avatar: {
    boxSizing: 'content-box',
    borderWidth: '4px',
    borderStyle: 'solid',
    borderColor: cssVar.colorBgLayout,
    backgroundColor: cssVar.colorText,
    backgroundImage: 'none',
  },
  background: {
    position: 'relative',
    width: '100%',
    padding: '24px',
    backgroundColor: cssVar.colorBgLayout,
    backgroundPosition: 'center',
    backgroundSize: '120% 120%',
  },
  container: {
    position: 'relative',
    overflow: 'hidden',
    width: '100%',
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: cssVar.colorBorder,
    borderRadius: `calc(${cssVar.borderRadiusLG} * 2)`,
    backgroundColor: cssVar.colorBgLayout,
    backgroundImage: 'none',
    boxShadow: cssVar.boxShadow,
  },
  footer: {
    fontSize: '12px',
    color: cssVar.colorTextDescription,
  },
  preview: {
    overflowX: 'hidden',
    overflowY: 'scroll',
    width: '100%',
    maxHeight: { default: '70dvh', [media.sm]: '40dvh' },
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: cssVar.colorBorder,
    borderRadius: cssVar.borderRadiusLG,
    backgroundColor: cssVar.colorBgLayout,
    backgroundImage: 'none',
  },
  title: {
    fontSize: '24px',
    fontWeight: 'bold',
    textAlign: 'center',
  },
});

const fallback = createStaticStyles(({ css }) => ({
  heatmaps: css`
    .legend-month,
    footer {
      display: none;
    }
  `,
  preview: css`
    * {
      pointer-events: none;

      ::-webkit-scrollbar {
        width: 0 !important;
        height: 0 !important;
      }
    }
  `,
}));

const backgroundImage = { backgroundImage: `url(${imageUrl('screenshot_background.webp')})` };

const Preview = memo(() => {
  const { t } = useTranslation('auth');

  return (
    <div {...sx(styles.preview, cx(lobeStaticStylish.noScrollbar, fallback.preview))}>
      <div {...sx(styles.background, backgroundImage)} id={'preview'}>
        <Center className={stylex.props(styles.container).className} gap={12} padding={24}>
          <ProductLogo size={24} type={'text'} />
          <div {...stylex.props(styles.title)}>{t('stats.share.title')}</div>
          <Flexbox horizontal align={'center'}>
            <UserAvatar
              className={stylex.props(styles.avatar).className}
              shape={'circle'}
              size={48}
              style={{
                marginRight: -12,
                zIndex: 2,
              }}
            />
            <Center
              className={stylex.props(styles.avatar).className}
              height={48}
              width={48}
              style={{
                borderRadius: '50%',
                zIndex: 1,
              }}
            >
              <ProductLogo size={40} />
            </Center>
          </Flexbox>
          <Flexbox gap={12} paddingBlock={12} width={'100%'}>
            <AiHeatmaps
              inShare
              blockMargin={2}
              blockRadius={1}
              blockSize={4.5}
              className={fallback.heatmaps}
              width={'100%'}
              style={{
                marginTop: -12,
              }}
            />
            <Grid gap={8} maxItemWidth={100} rows={2} width={'100%'}>
              <TotalMessages inShare />
              <TotalTokens inShare />
            </Grid>
          </Flexbox>
          <div {...stylex.props(styles.footer)}>{OFFICIAL_URL}</div>
        </Center>
      </div>
    </div>
  );
});

export default Preview;
