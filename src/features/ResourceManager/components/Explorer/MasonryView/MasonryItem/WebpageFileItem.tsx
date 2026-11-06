import { Flexbox, Icon, stopPropagation } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { ExternalLinkIcon, GlobeIcon } from 'lucide-react';
import { memo } from 'react';

const styles = stylex.create({
  domain: {
    overflow: 'hidden',
    display: 'flex',
    gap: '6px',
    alignItems: 'center',
    fontSize: '12px',
    color: cssVar.colorTextQuaternary,
  },
  // Was the `.domain span` rule, which also matched the icon's wrapper span.
  domainText: {
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  excerpt: {
    overflow: 'hidden',
    display: '-webkit-box',
    WebkitBoxOrient: 'vertical',
    WebkitLineClamp: '5',
    fontSize: '12px',
    lineHeight: 1.7,
    color: cssVar.colorTextSecondary,
    wordBreak: 'break-word',
  },
  // the reading-card paper feel: a quiet tinted sheet above the fold
  excerptWrapper: {
    padding: '14px',
    borderBlockEndWidth: '1px',
    borderBlockEndStyle: 'solid',
    borderBlockEndColor: cssVar.colorBorderSecondary,
    backgroundImage:
      'radial-gradient(140% 100% at 50% 0%, color-mix(in srgb, #fff 10%, transparent) 0%, transparent 60%)',
    backgroundColor: cssVar.colorFillQuaternary,
  },
  info: {
    padding: '12px',
  },
  openLink: {
    cursor: 'pointer',
    display: 'grid',
    flex: 'none',
    placeItems: 'center',
    width: '22px',
    height: '22px',
    borderRadius: cssVar.borderRadiusSM,
    color: { 'default': cssVar.colorTextQuaternary, ':hover': cssVar.colorText },
    backgroundColor: { 'default': null, ':hover': cssVar.colorFillTertiary },
    backgroundImage: { 'default': null, ':hover': 'none' },
  },
  title: {
    overflow: 'hidden',
    display: '-webkit-box',
    WebkitBoxOrient: 'vertical',
    WebkitLineClamp: '2',
    fontSize: '13px',
    fontWeight: cssVar.fontWeightStrong,
    color: cssVar.colorText,
    wordBreak: 'break-word',
  },
});

const hostnameOf = (url?: string): string | null => {
  if (!url) return null;
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return null;
  }
};

/**
 * Clippings without a real page title store the URL in `name`. A raw URL as a
 * bold card title reads broken — fall back to the last path segment (the
 * document name, e.g. `SKILL.md`) or the hostname; the full source stays on
 * the domain row and the open-link button.
 */
export const displayTitle = (name: string): string => {
  if (!/^https?:\/\//.test(name.trim())) return name;
  try {
    const parsed = new URL(name.trim());
    const lastSegment = decodeURIComponent(
      parsed.pathname.split('/').findLast(Boolean) ?? '',
    ).trim();
    return lastSegment || parsed.hostname.replace(/^www\./, '');
  } catch {
    return name;
  }
};

interface WebpageFileItemProps {
  contentPreview?: string | null;
  name: string;
  url?: string;
}

/**
 * Masonry card for web clippings — a Cubox-style reading card: excerpt sheet
 * on top, title and source domain below, with a direct link to the original.
 */
const WebpageFileItem = memo<WebpageFileItemProps>(({ contentPreview, name, url }) => {
  const hostname = hostnameOf(url);
  const title = displayTitle(name);

  return (
    <>
      {contentPreview && (
        <div {...stylex.props(styles.excerptWrapper)}>
          <div {...stylex.props(styles.excerpt)}>{contentPreview}</div>
        </div>
      )}
      <Flexbox className={stylex.props(styles.info).className} gap={8}>
        <span {...stylex.props(styles.title)}>{title}</span>
        <Flexbox horizontal align={'center'} gap={8} justify={'space-between'}>
          <div {...stylex.props(styles.domain)}>
            <Icon icon={GlobeIcon} size={13} />
            {hostname && <span {...stylex.props(styles.domainText)}>{hostname}</span>}
          </div>
          {url && (
            <button
              aria-label={'open source page'}
              {...stylex.props(styles.openLink)}
              type={'button'}
              onPointerDown={stopPropagation}
              onClick={(e) => {
                stopPropagation(e);
                window.open(url, '_blank', 'noopener,noreferrer');
              }}
            >
              <Icon icon={ExternalLinkIcon} size={13} />
            </button>
          )}
        </Flexbox>
      </Flexbox>
    </>
  );
});

WebpageFileItem.displayName = 'WebpageFileItem';

export default WebpageFileItem;
