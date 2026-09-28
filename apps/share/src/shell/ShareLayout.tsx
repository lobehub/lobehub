'use client';

import { copyToClipboard, Flexbox } from '@lobehub/ui';
import { ActionIcon, Text, toast } from '@lobehub/ui/base-ui';
import { createStaticStyles } from 'antd-style';
import { LinkIcon } from 'lucide-react';
import { type CSSProperties, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { ShareHeaderMenu, ShareLogoLink } from '@/business/client/features/ShareChrome';
import { ProductLogo } from '@/components/Branding';
import Loading from '@/components/Loading/BrandTextLoading';
import { DESKTOP_HEADER_ICON_SMALL_SIZE } from '@/const/layoutTokens';
import ShareErrorView from '@/features/Share/ErrorView';

const HEADER_HEIGHT = 44;
const GUTTER_MIN_WIDTH = 316;

// The floating/bar switch is resolved in CSS so the SSR document already has
// the final geometry: `--share-bar-height` is the header height while the lane is
// narrower than `--share-float-min`, and 0 once the side gutters can hold the
// header — the backdrop collapses and the body's top offset goes with it.
// Scroll content that starts under a floating header pads itself by
// `--share-header-overlap` (see ShareHero).
const styles = createStaticStyles(({ css, cssVar }) => ({
  body: css`
    position: relative;
    overflow: hidden;
    padding-block-start: var(--share-bar-height);
  `,
  divider: css`
    flex: none;
    width: 1px;
    height: 16px;
    background: ${cssVar.colorFill};
  `,
  header: css`
    pointer-events: none;

    position: absolute;
    z-index: 10;
    inset-block-start: 0;
    inset-inline: 0;

    display: flex;
    gap: 12px;
    align-items: center;
    justify-content: space-between;

    height: ${HEADER_HEIGHT}px;
    padding-inline: 12px;

    &::before {
      content: '';

      position: absolute;
      z-index: -1;
      inset-block-start: 0;
      inset-inline: 0;

      height: var(--share-bar-height);

      background: ${cssVar.colorBgContainer};
      box-shadow: inset 0 -1px 0 ${cssVar.colorBorderSecondary};
    }

    > * {
      pointer-events: auto;
    }
  `,
  lane: css`
    --share-bar-height: clamp(
      0px,
      calc((var(--share-float-min, 100000px) - 100cqw) * 1000),
      ${HEADER_HEIGHT}px
    );
    --share-header-overlap: calc(${HEADER_HEIGHT}px - var(--share-bar-height));

    position: relative;

    container-type: inline-size;
    overflow: hidden;
    display: flex;
    flex: 1;
    flex-direction: column;

    min-width: 0;

    background: ${cssVar.colorBgContainer};
  `,
  lead: css`
    display: flex;
    flex: 0 1 auto;
    gap: 10px;
    align-items: center;

    min-width: 0;
    max-width: max(
      calc((100cqw - var(--share-content-width, 0px)) / 2 - 24px),
      calc(var(--share-bar-height) * 1000)
    );
  `,
}));

export interface ShareLayoutProps {
  actions?: ReactNode;
  aside?: ReactNode;
  children?: ReactNode;
  contentWidth?: number;
  error?: unknown;
  loading?: boolean;
  title?: string | null;
}

const CopyLinkAction = () => {
  const { t } = useTranslation('chat');

  const handleCopy = async () => {
    await copyToClipboard(window.location.href);
    toast.success(t('shareModal.copyLinkSuccess'));
  };

  return (
    <ActionIcon
      aria-label={t('sharePage.menu.copyLink')}
      icon={LinkIcon}
      size={DESKTOP_HEADER_ICON_SMALL_SIZE}
      title={t('sharePage.menu.copyLink')}
      onClick={handleCopy}
    />
  );
};

const ShareLayout = ({
  actions,
  aside,
  children,
  contentWidth,
  error,
  loading,
  title,
}: ShareLayoutProps) => {
  let body = children;
  if (error) body = <ShareErrorView error={error} />;
  else if (loading) body = <Loading debugId="share layout" />;

  const laneStyle = contentWidth
    ? ({
        '--share-content-width': `${contentWidth}px`,
        '--share-float-min': `${contentWidth + 2 * GUTTER_MIN_WIDTH}px`,
      } as CSSProperties)
    : undefined;

  return (
    <Flexbox horizontal height={'100%'} style={{ overflow: 'hidden' }} width={'100%'}>
      <div className={styles.lane} style={laneStyle}>
        <header className={styles.header}>
          <div className={styles.lead}>
            <ShareLogoLink>
              <ProductLogo size={24} />
            </ShareLogoLink>
            {title && !error && (
              <>
                <span className={styles.divider} />
                <Text
                  ellipsis={{ tooltipWhenOverflow: true }}
                  fontSize={14}
                  style={{ minWidth: 0 }}
                  weight={600}
                >
                  {title}
                </Text>
              </>
            )}
          </div>
          <Flexbox horizontal align={'center'} flex={'none'} gap={2}>
            {!error && !loading && actions}
            {!error && <CopyLinkAction />}
            <ShareHeaderMenu />
          </Flexbox>
        </header>
        <Flexbox className={styles.body} flex={1}>
          {body}
        </Flexbox>
      </div>
      {aside}
    </Flexbox>
  );
};

export default ShareLayout;
