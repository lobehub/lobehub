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

/**
 * Strip clipping noise down to readable excerpt text: YAML frontmatter,
 * markdown images/links (including the `(<url>)` angle-bracket form and
 * empty-text link shells), html tags and markdown punctuation.
 *
 * The output is a plain-text excerpt: after tag stripping every remaining
 * angle bracket is dropped too, so no `<script`-style fragment can survive
 * (js/incomplete-multi-character-sanitization).
 */
export const excerptOf = (content?: string | null): string => {
  let text = (content ?? '')
    .replace(/^\s*---[\s\S]*?---\s*/, '')
    .replaceAll(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replaceAll(/\[([^\]]*)\]\([^)]*\)/g, '$1');

  // strip html tags to a fixpoint — a single pass can splice a new tag
  // together (e.g. `<scr<b>ipt`), which is exactly what CodeQL flags
  let previous: string;
  do {
    previous = text;
    text = text.replaceAll(/<\/?[a-z][^>]*>/gi, '');
  } while (text !== previous);

  return (
    text
      // markdown table rulers (|:---|---|) survive as long dash runs once the
      // pipes are stripped — drop them together with any leftover link shells
      .replaceAll(/:?-{3,}:?/g, ' ')
      .replaceAll(/\[\s*\]/g, '')
      // plain-text excerpt: no angle brackets survive at all
      .replaceAll(/[#*<>`_\\|]/g, '')
      .replaceAll(/\(\s*\)/g, '')
      // nested-link leftovers surface as stray bracket runs like `(]`
      .replaceAll(/[()[\]]{2,}/g, ' ')
      .replaceAll(/\s+/g, ' ')
      .trim()
      .slice(0, 240)
  );
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
  const title = displayTitle(name);

  return (
    <>
      {excerpt && (
        <div className={styles.excerptWrapper}>
          <div className={styles.excerpt}>{excerpt}</div>
        </div>
      )}
      <Flexbox className={styles.info} gap={8}>
        <span className={styles.title}>{title}</span>
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
