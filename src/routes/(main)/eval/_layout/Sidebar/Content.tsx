'use client';

import { SWRConfig } from 'swr';

import SideBarLayout from '@/features/NavPanel/SideBarLayout';

import Body from './Body';
import Header from './Header';

/**
 * The sidebar is persistent chrome, not route content: it outlives every route
 * under it and its lists carry their own Retry. Route-wide `suspense` would let
 * one failing list throw past them to the route boundary and blank the whole
 * eval workspace, so the sidebar opts out.
 */
const EvalSidebarContent = () => (
  <SWRConfig value={{ suspense: false }}>
    <SideBarLayout body={<Body />} header={<Header />} />
  </SWRConfig>
);

export default EvalSidebarContent;
