import { Flexbox, Icon, stopPropagation } from '@lobehub/ui';
import { createStaticStyles } from 'antd-style';
import { ExternalLinkIcon, GlobeIcon } from 'lucide-react';
import { memo } from 'react';

const styles = createStaticStyles(({ css, cssVar }) => ({
  domain: css`
    overflow: hidden;
    display: flex;
    gap: 6px;
    align-items: center;

    font-size: 12px;
    color: ${cssVar.colorTextQuaternary};

    span {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
  `,
  excerpt: css`
    overflow: hidden;
    display: -webkit-box;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 5;

    font-size: 12px;
    line-height: 1.7;
    color: ${cssVar.colorTextSecondary};
    word-break: break-word;
  `,
  excerptWrapper: css`
    padding: 14px;
    border-block-end: 1px solid ${cssVar.colorBorderSecondary};

    /* the reading-card paper feel: a quiet tinted sheet above the fold */
    background:
      radial-gradient(
        140% 100% at 50% 0%,
        color-mix(in srgb, #fff 10%, transparent) 0%,
        transparent 60%
      ),
      ${cssVar.colorFillQuaternary};
  `,
  info: css`
    padding: 12px;
  `,
  openLink: css`
    cursor: pointer;

    display: grid;
    flex: none;
    place-items: center;

    width: 22px;
    height: 22px;
    border-radius: ${cssVar.borderRadiusSM};

    color: ${cssVar.colorTextQuaternary};

    &:hover {
      color: ${cssVar.colorText};
      background: ${cssVar.colorFillTertiary};
    }
  `,
  title: css`
    overflow: hidden;
    display: -webkit-box;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 2;

    font-size: 13px;
    font-weight: ${cssVar.fontWeightStrong};
    color: ${cssVar.colorText};
    word-break: break-word;
  `,
}));

const hostnameOf = (url?: string): string | null => {
  if (!url) return null;
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return null;
  }
};

/** Strip markdown noise (images, links, emphasis) down to readable excerpt text. */
const excerptOf = (content?: string | null): string =>
  (content ?? '')
    .replaceAll(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replaceAll(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replaceAll(/[#*>`_\\]/g, '')
    .replaceAll(/\s+/g, ' ')
    .trim()
    .slice(0, 240);

interface WebpageFileItemProps {
  content?: string | null;
  name: string;
  url?: string;
}

/**
 * Masonry card for web clippings — a Cubox-style reading card: excerpt sheet
 * on top, title and source domain below, with a direct link to the original.
 */
const WebpageFileItem = memo<WebpageFileItemProps>(({ content, name, url }) => {
  const hostname = hostnameOf(url);
  const excerpt = excerptOf(content);

  return (
    <>
      {excerpt && (
        <div className={styles.excerptWrapper}>
          <div className={styles.excerpt}>{excerpt}</div>
        </div>
      )}
      <Flexbox className={styles.info} gap={8}>
        <span className={styles.title}>{name}</span>
        <Flexbox horizontal align={'center'} gap={8} justify={'space-between'}>
          <div className={styles.domain}>
            <Icon icon={GlobeIcon} size={13} />
            {hostname && <span>{hostname}</span>}
          </div>
          {url && (
            <button
              aria-label={'open source page'}
              className={styles.openLink}
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
