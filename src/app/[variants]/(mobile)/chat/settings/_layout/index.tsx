'use client';

import type {PropsWithChildren} from 'react';

import MobileContentLayout from '@/components/server/MobileNavLayout';
import Footer from '@/features/Setting/Footer';

import Header from './Header';

const Layout = ({ children }: PropsWithChildren) => (
  <MobileContentLayout header={<Header />}>
    {children}
    <Footer />
  </MobileContentLayout>
);

export default Layout;
