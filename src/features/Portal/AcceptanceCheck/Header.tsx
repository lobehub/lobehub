'use client';

import { memo } from 'react';

import PortalChromeHeader from '@/features/Portal/components/Header';

import Title from './Title';

const Header = memo(() => <PortalChromeHeader paddingInline={24} title={<Title />} />);

Header.displayName = 'AcceptanceCheckPortalHeader';

export default Header;
