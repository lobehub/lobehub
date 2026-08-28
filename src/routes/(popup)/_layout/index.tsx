'use client';

import { HotkeyScopeEnum } from '@lobechat/const/hotkeys';
import { Flexbox } from '@lobehub/ui';
import { createStaticStyles } from 'antd-style';
import { type FC } from 'react';
import { HotkeysProvider } from 'react-hotkeys-hook';
import { Outlet } from 'react-router';

import ProtocolUrlHandler from '@/features/ProtocolUrlHandler';
import { useFetchActiveTopicDetail } from '@/hooks/useFetchActiveTopicDetail';
import { useChatStore } from '@/store/chat';
import { topicSelectors } from '@/store/chat/selectors';

import PopupTitleBar from './TitleBar';

const styles = createStaticStyles(({ css, cssVar }) => ({
  container: css`
    background: ${cssVar.colorBgContainer};
  `,
}));

const PopupLayout: FC = () => {
  const topicTitle = useChatStore((s) => topicSelectors.currentActiveTopic(s)?.title);

  // Archived topics fall out of the sidebar list fetch — pull their detail by
  // id so the title doesn't degrade to the "new topic" placeholder.
  useFetchActiveTopicDetail();

  return (
    <HotkeysProvider initiallyActiveScopes={[HotkeyScopeEnum.Global]}>
      <Flexbox
        className={styles.container}
        height={'100%'}
        style={{ overflow: 'hidden' }}
        width={'100%'}
      >
        <PopupTitleBar title={topicTitle} />
        <Flexbox flex={1} style={{ minHeight: 0, overflow: 'hidden', position: 'relative' }}>
          <Outlet />
        </Flexbox>
        <ProtocolUrlHandler />
      </Flexbox>
    </HotkeysProvider>
  );
};

export default PopupLayout;
