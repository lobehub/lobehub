import { isDesktop } from '@lobechat/const';
import { RENDERER_HANDLED_LINK_ATTR } from '@lobechat/desktop-bridge';
import type { UniformSearchResult } from '@lobechat/types';
import { Block, Flexbox, Text } from '@lobehub/ui';
import { createStaticStyles } from 'antd-style';
import type { CSSProperties, MouseEvent } from 'react';
import { memo } from 'react';

import WebFavicon from '@/components/WebFavicon';
import { useGlobalStore } from '@/store/global';
import { useUserStore } from '@/store/user';
import { labPreferSelectors } from '@/store/user/selectors';

const styles = createStaticStyles(({ css }) => ({
  container: css`
    cursor: pointer;

    height: 100%;
    padding: 8px;

    font-size: 12px;
    color: initial;
  `,
}));

const SearchResultItem = memo<UniformSearchResult & { style?: CSSProperties }>(
  ({ url, title, style }) => {
    const urlObj = new URL(url);
    const host = urlObj.hostname;
    const openInBrowserTab = useGlobalStore((s) => s.openInBrowserTab);
    const enableInAppBrowser = useUserStore(labPreferSelectors.enableInAppBrowser);

    // Only claim the click when this onClick will actually handle it. Otherwise the
    // anchor's default behavior — and the desktop preload's external-link branch —
    // opens the system browser.
    const handlesClick = isDesktop && enableInAppBrowser;

    const handleClick = (event: MouseEvent<HTMLAnchorElement>) => {
      if (!handlesClick) return;

      event.preventDefault();
      openInBrowserTab(url);
    };

    return (
      <a
        {...(handlesClick ? { [RENDERER_HANDLED_LINK_ATTR]: 'true' } : {})}
        href={url}
        target={'_blank'}
        onClick={handleClick}
      >
        <Block
          clickable
          className={styles.container}
          gap={2}
          justify={'space-between'}
          style={style}
          variant={'outlined'}
        >
          <Text ellipsis={{ rows: 2 }}>{title}</Text>
          <Flexbox horizontal align={'center'} gap={4}>
            <WebFavicon size={14} title={title} url={url} />
            <Text ellipsis type={'secondary'}>
              {host.replace('www.', '')}
            </Text>
          </Flexbox>
        </Block>
      </a>
    );
  },
);

export default SearchResultItem;
