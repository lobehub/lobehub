'use client';

import { memo } from 'react';

import Body from '@/features/LobeBench/Layout/Sidebar/Body';
import Header from '@/features/LobeBench/Layout/Sidebar/Header';
import SideBarLayout from '@/features/NavPanel/SideBarLayout';

const Content = memo(() => <SideBarLayout body={<Body />} header={<Header />} />);

export default Content;
