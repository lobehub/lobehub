'use client';

import { Flexbox, Popover } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import isEqual from 'fast-deep-equal';
import { memo } from 'react';

import Image from '@/libs/next/Image';

import { dataSelectors, useConversationStore } from '../../../store';
import { type MarkdownElementProps } from '../type';

const styles = stylex.create({
  imageCardLink: {
    color: 'inherit',
    textDecoration: 'none',
    transition: 'opacity 0.2s',
    opacity: { 'default': null, ':hover': 0.75 },
  },
  imageDomain: {
    overflow: 'hidden',
    fontSize: '0.8em',
    lineHeight: 1,
    color: cssVar.colorTextQuaternary,
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  imageThumb: {
    display: 'block',
    width: '100%',
    height: '160px',
    borderRadius: '6px',
    objectFit: 'cover',
  },
  imageTitle: {
    overflow: 'hidden',
    display: '-webkit-box',
    WebkitBoxOrient: 'vertical',
    WebkitLineClamp: '2',
    fontSize: '0.95em',
    lineHeight: 1.4,
    color: cssVar.colorTextSecondary,
    textOverflow: 'ellipsis',
  },
  refChip: {
    cursor: 'pointer',
    display: 'inline-flex',
    gap: '4px',
    alignItems: 'center',
    paddingBlock: '1px',
    paddingInline: '6px',
    borderRadius: '4px',
    fontSize: '0.8em',
    color: cssVar.colorTextSecondary,
    textDecoration: 'none',
    verticalAlign: '-1px',
    backgroundColor: { 'default': cssVar.colorFillSecondary, ':hover': cssVar.colorFill },
    backgroundImage: { 'default': 'none', ':hover': 'none' },
    transition: 'background 0.15s',
  },
  thumbWrap: {
    overflow: 'hidden',
    display: 'inline-flex',
    flexShrink: 0,
    width: '16px',
    height: '16px',
    borderRadius: '3px',
  },
});

interface ImageSearchRefProperties {
  imageIndex: number;
  originalText: string;
}

const stripHtml = (html: string) => html.replaceAll(/<[^>]*>/g, '');

const Render = memo<MarkdownElementProps<ImageSearchRefProperties>>(({ node, id }) => {
  const { imageIndex, originalText } = node?.properties || {};

  const imageResults = useConversationStore(
    (s) => dataSelectors.getDbMessageById(id)(s)?.search?.imageResults,
    isEqual,
  );

  // Fallback: no image results on this message (e.g. non-image-search model)
  const image = imageResults?.[imageIndex];
  if (!image) return <span>{originalText}</span>;

  const popoverContent = (
    <Flexbox gap={4} style={{ maxWidth: 240 }}>
      {image.imageUri && (
        <a
          {...stylex.props(styles.imageCardLink)}
          href={image.imageUri}
          rel="noopener noreferrer"
          target="_blank"
        >
          <img
            alt={image.title ? stripHtml(image.title) : ''}
            {...stylex.props(styles.imageThumb)}
            src={image.imageUri}
          />
        </a>
      )}
      <a
        {...stylex.props(styles.imageCardLink)}
        href={image.sourceUri || image.imageUri}
        rel="noopener noreferrer"
        target="_blank"
        title={image.title ? stripHtml(image.title) : undefined}
      >
        <Flexbox gap={2}>
          {image.title && <div {...stylex.props(styles.imageTitle)}>{stripHtml(image.title)}</div>}
          {image.domain && (
            <Flexbox horizontal align="center" gap={4}>
              <Image
                unoptimized
                alt={image.domain}
                height={12}
                src={`https://icons.duckduckgo.com/ip3/${image.domain}.ico`}
                style={{ borderRadius: 2, flexShrink: 0 }}
                width={12}
              />
              <div {...stylex.props(styles.imageDomain)}>{image.domain}</div>
            </Flexbox>
          )}
        </Flexbox>
      </a>
    </Flexbox>
  );

  return (
    <Popover content={popoverContent} trigger="hover">
      <a
        href={image.imageUri}
        rel="noopener noreferrer"
        style={{ color: 'inherit', textDecoration: 'none' }}
        target="_blank"
      >
        <span {...stylex.props(styles.refChip)}>
          {image.imageUri && (
            <span {...stylex.props(styles.thumbWrap)}>
              <img
                alt=""
                src={image.imageUri}
                style={{ height: '100%', objectFit: 'cover', width: '100%' }}
              />
            </span>
          )}
          {originalText}
        </span>
      </a>
    </Popover>
  );
});

Render.displayName = 'ImageSearchRefRender';

export default Render;
