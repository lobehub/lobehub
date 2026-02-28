import { imageUrl,OFFICIAL_URL } from '@lobechat/const';
import { Center, Flexbox, Grid, lobeStaticStylish } from '@lobehub/ui';
import { createStaticStyles, cx, responsive } from 'antd-style';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { ProductLogo } from '@/components/Branding';
import UserAvatar from '@/features/User/UserAvatar';

import AiHeatmaps from '../../visualization/AiHeatmaps';
import TotalMessages from '../TotalMessages';
import TotalWords from '../TotalWords';

const styles = createStaticStyles(({ css, cssVar }) => ({
  avatar: css`
    box-sizing: content-box;
    border: 4px solid ${cssVar.colorBgLayout};
    background: ${cssVar.colorText};
  `,
  background: css`
    position: relative;

    width: 100%;
    padding: 24px;

    background-color: ${cssVar.colorBgLayout};
    background-image: url(${imageUrl('screenshot_background.webp')});
    background-position: center;
    background-size: 120% 120%;
  `,

  container: css`
    position: relative;

    overflow: hidden;

    width: 100%;
    border: 1px solid ${cssVar.colorBorder};
    border-radius: calc(${cssVar.borderRadiusLG} * 2);

    background: ${cssVar.colorBgLayout};
    box-shadow: ${cssVar.boxShadow};
  `,
  decs: css`
    font-size: 12px;
    color: ${cssVar.colorTextDescription};
  `,
  footer: css`
    font-size: 12px;
    color: ${cssVar.colorTextDescription};
  `,
  heatmaps: css`
    .legend-month,
    footer {
      display: none;
    }
  `,
  preview: cx(
    lobeStaticStylish.noScrollbar,
    css`
      overflow: hidden scroll;

      width: 100%;
      max-height: 70dvh;
      border: 1px solid ${cssVar.colorBorder};
      border-radius: ${cssVar.borderRadiusLG};

      background: ${cssVar.colorBgLayout};

      * {
        pointer-events: none;

        ::-webkit-scrollbar {
          width: 0 !important;
          height: 0 !important;
        }
      }

      ${responsive.sm} {
        max-height: 40dvh;
      }
    `,
  ),
  title: css`
    font-size: 24px;
    font-weight: bold;
    text-align: center;
  `,
}));

const Preview = memo(() => {
  const { t } = useTranslation('auth');

  return (
    <div className={styles.preview}>
      <div className={styles.background} id={'preview'}>
        <Center className={styles.container} gap={12} padding={24}>
          <ProductLogo size={24} type={'text'} />
          <div className={styles.title}>{t('stats.share.title')}</div>
          <Flexbox horizontal align={'center'}>
            <UserAvatar
              className={styles.avatar}
              shape={'circle'}
              size={48}
              style={{
                marginRight: -12,
                zIndex: 2,
              }}
            />
            <Center
              className={styles.avatar}
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
              className={styles.heatmaps}
              width={'100%'}
              style={{
                marginTop: -12,
              }}
            />
            <Grid gap={8} maxItemWidth={100} rows={2} width={'100%'}>
              <TotalMessages inShare />
              <TotalWords inShare />
            </Grid>
          </Flexbox>
          <div className={styles.footer}>{OFFICIAL_URL}</div>
        </Center>
      </div>
    </div>
  );
});

export default Preview;
