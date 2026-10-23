'use client';

import { type FC } from 'react';
import { Outlet } from 'react-router';

import MobileContentLayout from '@/components/server/MobileNavLayout';
import ChatHeader from '@/routes/(mobile)/chat/features/ChatHeader';

import { styles } from './style';

// Agent init, id sync and the 404 guard live one level up in the agent scope
// layout (`(mobile)/agent/_layout`), which the chat shares with the sub-pages.
const Layout: FC = () => (
  <MobileContentLayout className={styles.mainContainer} header={<ChatHeader />}>
    <Outlet />
  </MobileContentLayout>
);

export default Layout;
