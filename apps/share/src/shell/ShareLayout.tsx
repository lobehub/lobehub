'use client';

import { ActionIcon, copyToClipboard, Flexbox, Text, toast } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { LinkIcon } from 'lucide-react';
import { type ComponentType, type CSSProperties, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import * as ShareChrome from '@/business/client/features/ShareChrome';
import { ProductLogo } from '@/components/Branding';
import Loading from '@/components/Loading/BrandTextLoading';
import { DESKTOP_HEADER_ICON_SMALL_SIZE } from '@/const/layoutTokens';
import ShareErrorView, { type ShareNotFoundCopy } from '@/features/Share/ErrorView';
import { sx } from '@/styles/sx';

type HeaderActionsProps = {
  actions?: ReactNode;
  compactActions?: { key: string; label: string; onClick: () => void }[];
  copyLink?: ReactNode;
};

// The OSS build can be overlaid with Cloud main before its companion PR lands.
// Read the optional extension at runtime so that older overlays still build.
const ShareHeaderActions = (props: HeaderActionsProps) => {
  const Extension = Reflect.get(ShareChrome, 'ShareHeaderActions') as
    ComponentType<HeaderActionsProps> | undefined;
  return Extension ? (
    <Extension {...props} />
  ) : (
    <>
      {props.actions}
      {props.copyLink}
      <ShareChrome.ShareHeaderMenu />
    </>
  );
};
const ShareLogoLink = ShareChrome.ShareLogoLink;

const HEADER_HEIGHT = 44;
const GUTTER_MIN_WIDTH = 316;

// The floating/bar switch is resolved in CSS so the SSR document already has
// the final geometry: `--share-bar-height` is the header height while the lane is
// narrower than `--share-float-min`, and 0 once the side gutters can hold the
// header — the backdrop collapses and the body's top offset goes with it.
// Scroll content that starts under a floating header pads itself by
// `--share-header-overlap` (see ShareHero).
const styles = stylex.create({
  actions: { pointerEvents: 'auto' },
  body: {
    position: 'relative',
    overflow: 'hidden',
    paddingBlockStart: 'var(--share-bar-height)',
  },
  divider: {
    flex: 'none',
    width: '1px',
    height: '16px',
    backgroundColor: cssVar.colorFill,
    backgroundImage: 'none',
  },
  header: {
    'pointerEvents': 'none',
    'position': 'absolute',
    'zIndex': 10,
    'insetBlockStart': 0,
    'insetInline': 0,
    'display': 'flex',
    'gap': '12px',
    'alignItems': 'center',
    'justifyContent': 'space-between',
    'height': `${HEADER_HEIGHT}px`,
    'paddingInline': '12px',
    '::before': {
      content: '""',
      position: 'absolute',
      zIndex: -1,
      insetBlockStart: 0,
      insetInline: 0,
      height: 'var(--share-bar-height)',
      backgroundColor: cssVar.colorBgContainer,
      backgroundImage: 'none',
      boxShadow: `inset 0 -1px 0 ${cssVar.colorBorderSecondary}`,
    },
  },
  lane: {
    '--share-bar-height': `clamp(
      0px,
      calc((var(--share-float-min, 100000px) - 100cqw) * 1000),
      ${HEADER_HEIGHT}px
    )`,
    '--share-header-overlap': `calc(${HEADER_HEIGHT}px - var(--share-bar-height))`,
    'position': 'relative',
    'containerType': 'inline-size',
    'overflow': 'hidden',
    'display': 'flex',
    'flex': '1',
    'flexDirection': 'column',
    'minWidth': '0',
    'backgroundColor': cssVar.colorBgContainer,
    'backgroundImage': 'none',
  },
  lead: {
    pointerEvents: 'auto',
    display: 'flex',
    flexGrow: '0',
    flexShrink: '1',
    flexBasis: 'auto',
    gap: '10px',
    alignItems: 'center',
    minWidth: '0',
    maxWidth: `max(
      calc((100cqw - var(--share-content-width, 0px)) / 2 - 24px),
      calc(var(--share-bar-height) * 1000)
    )`,
  },
});

export interface ShareLayoutProps {
  actions?: ReactNode;
  aside?: ReactNode;
  children?: ReactNode;
  compactActions?: { key: string; label: string; onClick: () => void }[];
  contentWidth?: number;
  error?: unknown;
  loading?: boolean;
  /** Copy for a missing share; the error view defaults to the topic wording. */
  notFound?: ShareNotFoundCopy;
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
  compactActions,
  aside,
  children,
  contentWidth,
  error,
  loading,
  notFound,
  title,
}: ShareLayoutProps) => {
  let body = children;
  if (error) body = <ShareErrorView error={error} notFound={notFound} />;
  else if (loading) body = <Loading debugId="share layout" />;

  const laneStyle = contentWidth
    ? ({
        '--share-content-width': `${contentWidth}px`,
        '--share-float-min': `${contentWidth + 2 * GUTTER_MIN_WIDTH}px`,
      } as CSSProperties)
    : undefined;

  return (
    <Flexbox horizontal height={'100%'} style={{ overflow: 'hidden' }} width={'100%'}>
      <div {...sx(styles.lane, undefined, laneStyle)}>
        <header {...stylex.props(styles.header)}>
          <div {...stylex.props(styles.lead)}>
            <ShareLogoLink>
              <ProductLogo size={24} />
            </ShareLogoLink>
            {title && !error && (
              <>
                <span {...stylex.props(styles.divider)} />
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
          <Flexbox horizontal align={'center'} className={stylex.props(styles.actions).className} flex={'none'} gap={2}>
            <ShareHeaderActions
              actions={!error && !loading ? actions : undefined}
              compactActions={!error && !loading ? compactActions : undefined}
              copyLink={!error ? <CopyLinkAction /> : undefined}
            />
          </Flexbox>
        </header>
        <Flexbox className={stylex.props(styles.body).className} flex={1}>
          {body}
        </Flexbox>
      </div>
      {aside}
    </Flexbox>
  );
};

export default ShareLayout;
