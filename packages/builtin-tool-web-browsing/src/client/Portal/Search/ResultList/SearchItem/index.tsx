import { isDesktop } from '@lobechat/const';
import { RENDERER_HANDLED_LINK_ATTR } from '@lobechat/desktop-bridge';
import type { UniformSearchResult } from '@lobechat/types';
import { Flexbox, Text } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import type { MouseEvent } from 'react';
import { memo } from 'react';

import WebFavicon from '@/components/WebFavicon';
import { useGlobalStore } from '@/store/global';

import TitleExtra from './TitleExtra';
import Video from './Video';

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
  title: { fontSize: '16px', color: cssVar.colorLink },
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

const SearchItem = memo<SearchResultProps>((props) => {
  const { content, url, score, engines, title, category } = props;
  const openInBrowserTab = useGlobalStore((s) => s.openInBrowserTab);

  // Only claim the click when this onClick will actually handle it. Otherwise the
  // anchor's default behavior — and the desktop preload's external-link branch —
  // opens the system browser.
  const handlesClick = isDesktop && !!url;

  const handleClick = (event: MouseEvent<HTMLAnchorElement>) => {
    if (!handlesClick) return;

    event.preventDefault();
    openInBrowserTab(url!);
  };

  if (category === 'videos') return <Video {...props} />;

  return (
    <a
      {...(handlesClick ? { [RENDERER_HANDLED_LINK_ATTR]: 'true' } : {})}
      {...stylex.props(styles.container)}
      href={url!}
      rel="noreferrer"
      target={'_blank'}
      onClick={handleClick}
    >
      <Flexbox distribution={'space-between'} flex={1} gap={8} padding={12}>
        <Flexbox gap={8}>
          <Flexbox horizontal align={'center'} distribution={'space-between'}>
            <Flexbox horizontal align={'center'} gap={8}>
              <WebFavicon title={title} url={url} />
              <Flexbox className={stylex.props(styles.title).className}>{title}</Flexbox>
            </Flexbox>
            <TitleExtra
              category={category}
              engines={engines}
              highlight={props.highlight}
              score={score}
            />
          </Flexbox>
          <Text className={stylex.props(styles.url).className} type={'secondary'}>
            {url}
          </Text>
          <Flexbox className={stylex.props(styles.desc).className}>{content}</Flexbox>
        </Flexbox>
      </Flexbox>
    </a>
  );
});

export default SearchItem;
