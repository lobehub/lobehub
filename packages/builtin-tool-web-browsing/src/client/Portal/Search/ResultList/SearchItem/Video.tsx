import type { UniformSearchResult } from '@lobechat/types';
import { Avatar, Flexbox, Text } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { memo, useState } from 'react';

import { ENGINE_ICON_MAP } from '../../../../../const';
import TitleExtra from './TitleExtra';

const styles = stylex.create({
  container: {
    display: 'flex',
    flex: '1',
    padding: '8px',
    borderRadius: '8px',
    color: 'initial',
    background: { 'default': null, ':hover': cssVar.colorFillTertiary },
  },
  desc: {
    overflow: 'hidden',
    display: '-webkit-box',
    WebkitBoxOrient: 'vertical',
    WebkitLineClamp: '2',
    color: cssVar.colorTextTertiary,
    textOverflow: 'ellipsis',
  },
  iframe: {
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: cssVar.colorBorder,
    borderRadius: '8px',
  },
  title: {
    overflow: 'hidden',
    display: '-webkit-box',
    WebkitBoxOrient: 'vertical',
    WebkitLineClamp: '1',
    fontSize: '16px',
    color: cssVar.colorLink,
    textOverflow: 'ellipsis',
  },
  url: {
    overflow: 'hidden',
    display: '-webkit-box',
    WebkitBoxOrient: 'vertical',
    WebkitLineClamp: '1',
    color: cssVar.colorTextDescription,
    textOverflow: 'ellipsis',
  },
});

interface SearchResultProps extends UniformSearchResult {
  highlight?: boolean;
}
const VideoItem = memo<SearchResultProps>(
  ({ content, url, iframeSrc, highlight, score, engines, title, category, ...res }) => {
    const [expand, setExpand] = useState(false);

    const videoUrl = iframeSrc || (res as any).iframe_src; // iframe_src is a SearchXNG field, for backward compatibility with old data structure
    return (
      <Flexbox gap={12}>
        <Flexbox
          className={stylex.props(styles.container).className}
          onClick={() => setExpand(!expand)}
        >
          <Flexbox horizontal flex={1} gap={8} padding={12}>
            {videoUrl && (
              <Flexbox>
                <iframe
                  // alt={title}
                  className={stylex.props(styles.iframe).className}
                  height={100}
                  src={videoUrl}
                  width={200}
                  style={{
                    pointerEvents: 'none',
                  }}
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                  }}
                  onPlay={(e) => {
                    e.preventDefault();
                  }}
                />
              </Flexbox>
            )}
            <Flexbox flex={1} gap={8}>
              <Flexbox horizontal align={'center'} distribution={'space-between'} gap={12}>
                <Flexbox horizontal align={'center'} gap={8}>
                  <Avatar.Group
                    shape={'circle'}
                    size={20}
                    items={engines.map((engine) => ({
                      avatar: ENGINE_ICON_MAP[engine],
                      background: cssVar.colorBgLayout,
                      key: engine,
                      title: engine,
                    }))}
                  />
                  <Flexbox className={stylex.props(styles.title).className}>{title}</Flexbox>
                </Flexbox>
                <TitleExtra
                  category={category}
                  engines={engines}
                  highlight={highlight}
                  score={score}
                />
              </Flexbox>
              <Text className={stylex.props(styles.url).className} type={'secondary'}>
                {url}
              </Text>
              <Flexbox className={stylex.props(styles.desc).className}>{content}</Flexbox>
            </Flexbox>
          </Flexbox>
        </Flexbox>
        {expand && videoUrl && (
          <Flexbox>
            <iframe {...stylex.props(styles.iframe)} height={440} src={videoUrl} width={'100%'} />
          </Flexbox>
        )}
      </Flexbox>
    );
  },
);

export default VideoItem;
