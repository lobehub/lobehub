import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { useMemo, useState } from 'react';

import { useWorkspaces } from '@/business/client/hooks/useWorkspaces';
import { parseInternalLink } from '@/features/EntityLink/internalLink';
import { linkPreviewActions, linkPreviewSelectors, useLinkPreviewStore } from '@/store/linkPreview';

import { extractLinkPreviewUrls } from './linkPreviewUrls';

const styles = stylex.create({
  list: {
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
    alignItems: 'flex-start',
  },
  card: {
    display: 'flex',
    gap: 12,
    width: '100%',
    maxWidth: 432,
    paddingBlock: 10,
    paddingInlineStart: 12,
    paddingInlineEnd: 12,
    borderInlineStartWidth: 3,
    borderInlineStartStyle: 'solid',
    borderInlineStartColor: cssVar.colorFillSecondary,
    borderRadius: cssVar.borderRadius,
    backgroundColor: cssVar.colorFillQuaternary,
  },
  text: {
    display: 'flex',
    flexDirection: 'column',
    flex: '1',
    gap: 4,
    minWidth: 0,
  },
  siteName: {
    overflow: 'hidden',
    fontSize: 12,
    color: cssVar.colorTextTertiary,
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  title: {
    display: '-webkit-box',
    overflow: 'hidden',
    fontSize: 14,
    fontWeight: 600,
    lineHeight: 1.4,
    color: cssVar.colorText,
    textDecoration: {
      'default': 'none',
      ':hover': 'underline',
    },
    WebkitBoxOrient: 'vertical',
    WebkitLineClamp: 2,
  },
  description: {
    display: '-webkit-box',
    overflow: 'hidden',
    fontSize: 13,
    lineHeight: 1.5,
    color: cssVar.colorTextSecondary,
    WebkitBoxOrient: 'vertical',
    WebkitLineClamp: 3,
  },
  imageLink: {
    display: 'block',
    flexShrink: 0,
  },
  thumbnail: {
    display: 'block',
    width: 72,
    height: 72,
    borderRadius: cssVar.borderRadiusSM,
    objectFit: 'cover',
  },
  largeImage: {
    display: 'block',
    width: '100%',
    maxHeight: 240,
    marginBlockStart: 4,
    borderRadius: cssVar.borderRadiusSM,
    objectFit: 'cover',
  },
});

const LinkPreviewCard = ({ url }: { url: string }) => {
  linkPreviewActions.useFetchLinkPreview({ url });
  const preview = useLinkPreviewStore(linkPreviewSelectors.getPreview({ url }));
  // A page may refuse to be embedded elsewhere (hotlink protection, a
  // same-origin resource policy): the card then stands without its image.
  const [failedImage, setFailedImage] = useState<string>();

  // Nothing until the card arrives, and nothing for a page without one.
  if (!preview) return null;

  const image = preview.image && preview.image !== failedImage ? preview.image : undefined;
  const label = preview.title || preview.siteName || url;
  const imageElement = image && (
    <img
      alt={label}
      loading="lazy"
      referrerPolicy="no-referrer"
      src={image}
      {...stylex.props(preview.largeImage ? styles.largeImage : styles.thumbnail)}
      onError={() => setFailedImage(image)}
    />
  );

  return (
    <div {...stylex.props(styles.card)} data-testid="channel-link-preview">
      <div {...stylex.props(styles.text)}>
        {preview.siteName && <span {...stylex.props(styles.siteName)}>{preview.siteName}</span>}
        {preview.title && (
          <a href={url} rel="noopener noreferrer" target="_blank" {...stylex.props(styles.title)}>
            {preview.title}
          </a>
        )}
        {preview.description && (
          <span {...stylex.props(styles.description)}>{preview.description}</span>
        )}
        {preview.largeImage && imageElement && (
          <a
            aria-label={label}
            href={url}
            rel="noopener noreferrer"
            tabIndex={-1}
            target="_blank"
            {...stylex.props(styles.imageLink)}
          >
            {imageElement}
          </a>
        )}
      </div>
      {!preview.largeImage && imageElement && (
        <a
          aria-label={label}
          href={url}
          rel="noopener noreferrer"
          tabIndex={-1}
          target="_blank"
          {...stylex.props(styles.imageLink)}
        >
          {imageElement}
        </a>
      )}
    </div>
  );
};

/**
 * Cards for the web pages a message links (title, description and image from
 * the page's Open Graph tags), like Discord's embeds. Links into the app keep
 * their own entity chips and get no card.
 */
export const LinkPreviews = ({ content }: { content: string }) => {
  const workspaces = useWorkspaces();
  const slugKey = workspaces.map((workspace) => workspace.slug).join('\n');
  // Polling re-renders every message while replies run; scan the text only when it changes.
  const urls = useMemo(() => {
    const origin = typeof window === 'undefined' ? undefined : window.location.origin;
    const slugs = slugKey ? slugKey.split('\n') : [];
    return extractLinkPreviewUrls(content, (url) => !!parseInternalLink(url, origin, slugs));
  }, [content, slugKey]);

  if (urls.length === 0) return null;

  return (
    <div {...stylex.props(styles.list)}>
      {urls.map((url) => (
        <LinkPreviewCard key={url} url={url} />
      ))}
    </div>
  );
};
