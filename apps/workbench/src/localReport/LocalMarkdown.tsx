import Markdown from '@lobehub/ui/es/Markdown/Markdown';
import { Image, Video } from '@lobehub/ui/mdx';
import type { ComponentProps } from 'react';
import { useTranslation } from 'react-i18next';

import { mediaSource } from './mediaSource';

const ExternalMedia = ({
  alt,
  source,
}: {
  alt?: string;
  source: ReturnType<typeof mediaSource>;
}) => {
  const { t } = useTranslation('verify');
  return (
    <span style={{ display: 'block' }}>
      {t('acceptance.local.externalMedia')}{' '}
      {source.type === 'external' && (
        <a
          href={source.url}
          rel={'noreferrer'}
          style={{ display: 'inline-block', maxWidth: '100%', overflowWrap: 'anywhere' }}
          target={'_blank'}
        >
          {alt || t('acceptance.local.openExternalMedia')}
        </a>
      )}
    </span>
  );
};

const LocalImage = ({ alt, height, src, title, width }: ComponentProps<'img'>) => {
  const source = mediaSource(typeof src === 'string' ? src : undefined);
  return source.type === 'local' ? (
    <Image alt={alt} height={height} src={source.url} title={title} width={width} />
  ) : (
    <ExternalMedia alt={alt} source={source} />
  );
};

const LocalVideo = ({ height, poster, src, width }: ComponentProps<'video'>) => {
  const source = mediaSource(typeof src === 'string' ? src : undefined);
  return source.type === 'local' ? (
    <Video
      height={height}
      poster={mediaSource(poster).type === 'local' ? poster : undefined}
      src={source.url}
      width={width}
    />
  ) : (
    <ExternalMedia source={source} />
  );
};

/** Keep the normal renderer, but do not turn authored URLs into network requests. */
export const LocalMarkdown = ({ components, ...props }: ComponentProps<typeof Markdown>) => (
  <Markdown
    {...props}
    components={Object.assign({}, components, {
      img: LocalImage,
      video: LocalVideo,
    })}
  />
);
