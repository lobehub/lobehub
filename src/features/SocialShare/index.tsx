'use client';

import SiInstagram from '@icons-pack/react-simple-icons/icons/SiInstagram';
import SiSinaweibo from '@icons-pack/react-simple-icons/icons/SiSinaweibo';
import SiWechat from '@icons-pack/react-simple-icons/icons/SiWechat';
import SiX from '@icons-pack/react-simple-icons/icons/SiX';
import { Button, copyToClipboard, cx, Flexbox, QRCode, Text, toast, useTheme } from '@lobehub/ui';
import { CopyIcon, ExternalLinkIcon, LinkIcon } from 'lucide-react';
import {
  type ComponentType,
  type CSSProperties,
  memo,
  useCallback,
  useMemo,
  useState,
} from 'react';
import { useTranslation } from 'react-i18next';

import { useIsMobile } from '@/hooks/useIsMobile';

import {
  buildSocialShareActions,
  openShareWindow,
  shareToInstagram,
  SOCIAL_PLATFORMS,
  type SocialPlatform,
} from './socialShare';
import { styles } from './style';

const QR_SIZE = 112;
/**
 * Scanners need dark modules on a light ground, so the code ignores the theme.
 * The light ground comes from `theme.colorWhite`; there is no black token.
 */
// lobe-design-ignore LOBE-RAW-COLOR: QR modules must stay black in dark mode or WeChat can't scan them
const QR_MODULE_COLOR = '#000';

const PLATFORM_ICONS: Record<SocialPlatform, ComponentType<{ size?: number }>> = {
  instagram: SiInstagram,
  wechat: SiWechat,
  weibo: SiSinaweibo,
  x: SiX,
};

type SocialPanel = 'instagram' | 'wechat';

export interface SocialShareProps {
  className?: string;
  /** One line under the title in every post, e.g. what kind of content this is. */
  description?: string;
  /** Shown under the title while the buttons are disabled. */
  disabledHint?: string;
  /**
   * Called right before the user is sent to another site (X, Weibo, Instagram),
   * so the host popover can close instead of lingering over the page.
   */
  onLeave?: () => void;
  /** Public share link; empty while the content has no public link yet. */
  shareUrl?: string;
  style?: CSSProperties;
  /** Name of the shared content; leads every post. */
  title: string;
}

/**
 * Four-channel social share (X, Weibo, Instagram, WeChat Moments) for any
 * content that has a public link: topics, community agents, generations.
 */
const SocialShare = memo<SocialShareProps>(
  ({ className, style, description, disabledHint, onLeave, shareUrl, title }) => {
    const { t } = useTranslation('chat');
    const isMobile = useIsMobile();
    const theme = useTheme();
    // Instagram and WeChat have no web intent; their fallback opens inline.
    const [panel, setPanel] = useState<SocialPanel>();
    // The panel belongs to the link it was opened for. Turning the link off, back
    // on, or switching to another topic's link folds it (reset during render, so
    // the stale panel never paints).
    const [panelUrl, setPanelUrl] = useState(shareUrl);
    if (panelUrl !== shareUrl) {
      setPanelUrl(shareUrl);
      setPanel(undefined);
    }

    const disabled = !shareUrl;

    const actions = useMemo(
      () =>
        shareUrl
          ? buildSocialShareActions({
              description,
              title,
              url: shareUrl,
            })
          : undefined,
      [description, shareUrl, title],
    );

    const copyText = useCallback(async () => {
      if (!actions) return;
      await copyToClipboard(actions.instagram.copy.textWithUrl);
      toast.success(t('shareModal.social.copyTextSuccess'));
    }, [actions, t]);

    const copyLink = useCallback(async () => {
      if (!shareUrl) return;
      await copyToClipboard(shareUrl);
      toast.success(t('shareModal.copyLinkSuccess'));
    }, [shareUrl, t]);

    const handleClick = useCallback(
      async (platform: SocialPlatform) => {
        if (!actions) return;
        const action = actions[platform];

        switch (action.kind) {
          case 'intent': {
            setPanel(undefined);
            // Close the popover first, then leave; the click's user activation
            // still lets `window.open` through.
            onLeave?.();
            openShareWindow(action.href);
            return;
          }
          case 'clipboard': {
            setPanel('instagram');
            const result = await shareToInstagram(action.copy, {
              copy: copyToClipboard,
              // Desktop share sheets do not offer Instagram; only use it on mobile.
              navigator: isMobile && typeof navigator !== 'undefined' ? navigator : undefined,
            });
            if (result === 'copied') toast.success(t('shareModal.social.instagram.copied'));
            return;
          }
          case 'qrcode': {
            setPanel((current) => (current === 'wechat' ? undefined : 'wechat'));
          }
        }
      },
      [actions, isMobile, onLeave, t],
    );

    return (
      <Flexbox className={className} gap={10} style={style}>
        <Flexbox gap={1}>
          <Text strong type={disabled ? 'secondary' : undefined}>
            {t('shareModal.social.title')}
          </Text>
          {disabled && disabledHint && (
            <Text fontSize={12} type={'secondary'}>
              {disabledHint}
            </Text>
          )}
        </Flexbox>

        <div className={styles.socialGrid} role={'group'}>
          {SOCIAL_PLATFORMS.map((platform) => {
            const PlatformIcon = PLATFORM_ICONS[platform];
            const hasPanel = platform === 'instagram' || platform === 'wechat';
            const label = t(`shareModal.social.platform.${platform}`);

            return (
              <button
                aria-expanded={hasPanel ? panel === platform : undefined}
                aria-label={t('shareModal.social.shareTo', { platform: label })}
                className={cx(styles.socialTile, panel === platform && styles.socialTileActive)}
                data-platform={platform}
                disabled={disabled}
                key={platform}
                type={'button'}
                onClick={() => handleClick(platform)}
              >
                <span className={styles.socialIcon}>
                  <PlatformIcon size={18} />
                </span>
                <span className={styles.socialLabel}>{label}</span>
              </button>
            );
          })}
        </div>

        {actions && panel === 'instagram' && (
          <Flexbox className={styles.socialPanel} data-testid={'social-instagram-panel'} gap={10}>
            <Text fontSize={12} type={'secondary'}>
              {t('shareModal.social.instagram.hint')}
            </Text>
            <div className={styles.socialPreview}>{actions.instagram.copy.textWithUrl}</div>
            <Flexbox horizontal gap={6}>
              <Button block icon={CopyIcon} size={'small'} type={'primary'} onClick={copyText}>
                {t('shareModal.social.copyText')}
              </Button>
              <Button
                block
                href={actions.instagram.openUrl}
                icon={ExternalLinkIcon}
                rel={'noopener noreferrer'}
                size={'small'}
                target={'_blank'}
                onClick={onLeave}
              >
                {t('shareModal.social.instagram.open')}
              </Button>
            </Flexbox>
          </Flexbox>
        )}

        {actions && panel === 'wechat' && (
          <Flexbox
            horizontal
            align={'center'}
            className={styles.socialPanel}
            data-testid={'social-wechat-panel'}
            gap={12}
          >
            <div className={styles.qrcode}>
              <QRCode
                aria-label={t('shareModal.social.wechat.qrLabel')}
                // Dark modules on a light ground in every theme, or WeChat can't scan it.
                bgColor={theme.colorWhite}
                bordered={false}
                color={QR_MODULE_COLOR}
                size={QR_SIZE}
                value={actions.wechat.qrValue}
              />
            </div>
            <Flexbox flex={1} gap={8} style={{ minWidth: 0 }}>
              <Text fontSize={12} type={'secondary'}>
                {t('shareModal.social.wechat.hint')}
              </Text>
              <Button block icon={LinkIcon} size={'small'} onClick={copyLink}>
                {t('shareModal.copyLink')}
              </Button>
              <Button block icon={CopyIcon} size={'small'} onClick={copyText}>
                {t('shareModal.social.copyText')}
              </Button>
            </Flexbox>
          </Flexbox>
        )}
      </Flexbox>
    );
  },
);

SocialShare.displayName = 'SocialShare';

export default SocialShare;
