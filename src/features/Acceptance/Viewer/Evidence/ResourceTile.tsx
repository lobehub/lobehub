'use client';

import { Icon } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { AudioLines, FileText, Film, type LucideIcon, Play, SquareTerminal } from 'lucide-react';
import { memo, useState } from 'react';

import type { ResourceItem } from './resources';
import { formatVideoClock } from './Video/videoTime';

const styles = stylex.create({
  tile: {
    overflow: 'hidden',
    display: 'flex',
    flexDirection: 'column',
    minWidth: 0,
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: cssVar.colorBorderSecondary,
    borderRadius: '12px',
    color: cssVar.colorText,
    textDecoration: 'none',
    backgroundColor: cssVar.colorBgContainer,
  },
  link: {
    cursor: 'pointer',
    borderColor: { 'default': cssVar.colorBorderSecondary, ':hover': cssVar.colorBorder },
    outlineWidth: { 'default': null, ':focus-visible': '2px' },
    outlineStyle: { 'default': null, ':focus-visible': 'solid' },
    outlineColor: { 'default': null, ':focus-visible': cssVar.colorPrimary },
    outlineOffset: { 'default': null, ':focus-visible': '2px' },
  },
  stage: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    height: '192px',
    paddingBlock: '12px',
    paddingInline: '12px',
    borderBlockEndWidth: '1px',
    borderBlockEndStyle: 'solid',
    borderBlockEndColor: cssVar.colorBorderSecondary,
    color: cssVar.colorTextSecondary,
    backgroundColor: cssVar.colorFillQuaternary,
  },
  image: {
    maxWidth: '100%',
    maxHeight: '100%',
    borderRadius: '6px',
    objectFit: 'contain',
  },
  recording: {
    position: 'relative',
    overflow: 'hidden',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: '100%',
    height: '100%',
    borderRadius: '6px',
    color: '#fff',
    backgroundColor: '#111',
  },
  video: {
    position: 'absolute',
    inset: 0,
    width: '100%',
    height: '100%',
    objectFit: 'contain',
  },
  play: {
    position: 'relative',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: '36px',
    height: '36px',
    borderRadius: '50%',
    backgroundColor: 'rgba(0, 0, 0, 0.45)',
  },
  duration: {
    position: 'absolute',
    insetBlockEnd: '8px',
    insetInlineEnd: '8px',
    paddingInline: '8px',
    borderRadius: '4px',
    fontSize: '12px',
    fontVariantNumeric: 'tabular-nums',
    lineHeight: '20px',
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
  },
  meta: {
    display: 'flex',
    flexDirection: 'column',
    minWidth: 0,
    paddingBlock: '8px',
    paddingInline: '12px',
  },
  name: {
    overflow: 'hidden',
    fontSize: '12px',
    fontWeight: 500,
    lineHeight: '20px',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  detail: {
    overflow: 'hidden',
    fontSize: '12px',
    fontVariantNumeric: 'tabular-nums',
    lineHeight: '20px',
    color: cssVar.colorTextTertiary,
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
});

const TYPE_GLYPH: Record<string, LucideIcon> = {
  audio: AudioLines,
  terminal: SquareTerminal,
  video: Film,
};

const RecordingStage = ({ src, video }: { src: string; video: boolean }) => {
  const [duration, setDuration] = useState<number>();

  return (
    <div {...stylex.props(styles.recording)}>
      {video && (
        <video
          muted
          playsInline
          preload={'metadata'}
          src={src}
          tabIndex={-1}
          {...stylex.props(styles.video)}
          onLoadedMetadata={(event) => {
            const seconds = event.currentTarget.duration;
            if (Number.isFinite(seconds)) setDuration(seconds);
          }}
        />
      )}
      <span {...stylex.props(styles.play)}>
        <Icon icon={video ? Play : AudioLines} size={20} />
      </span>
      {duration !== undefined && (
        <span {...stylex.props(styles.duration)}>{formatVideoClock(duration)}</span>
      )}
    </div>
  );
};

const ResourceStage = ({ item, name }: { item: ResourceItem; name: string }) => {
  const { evidence, kind } = item;
  if (kind === 'screenshot')
    return (
      <img alt={name} loading={'lazy'} src={evidence.fileUrl!} {...stylex.props(styles.image)} />
    );
  if (kind === 'recording')
    return <RecordingStage src={evidence.fileUrl!} video={evidence.type === 'video'} />;
  return <Icon icon={TYPE_GLYPH[evidence.type] ?? FileText} size={20} />;
};

interface ResourceTileProps {
  detail: string;
  item: ResourceItem;
}

const ResourceTile = memo<ResourceTileProps>(({ detail, item }) => {
  const { checkTitle, evidence } = item;
  const name = evidence.fileName ?? evidence.description ?? checkTitle;
  const body = (
    <>
      <div {...stylex.props(styles.stage)}>
        <ResourceStage item={item} name={name} />
      </div>
      <div {...stylex.props(styles.meta)}>
        <span {...stylex.props(styles.name)}>{name}</span>
        <span {...stylex.props(styles.detail)}>{detail}</span>
      </div>
    </>
  );

  if (!evidence.fileUrl)
    return (
      <div title={checkTitle} {...stylex.props(styles.tile)}>
        {body}
      </div>
    );

  return (
    <a
      href={evidence.fileUrl}
      rel={'noreferrer'}
      target={'_blank'}
      title={checkTitle}
      {...stylex.props(styles.tile, styles.link)}
    >
      {body}
    </a>
  );
});

ResourceTile.displayName = 'AcceptanceResourceTile';

export default ResourceTile;
