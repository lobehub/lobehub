'use client';

import { memo } from 'react';

import PortalChromeHeader from '@/features/Portal/components/Header';

import Title from './Title';

const Header = memo<{ onClose?: () => void }>(({ onClose }) => (
  <PortalChromeHeader paddingInline={24} title={<Title />} onClose={onClose} />
));

Header.displayName = 'AcceptanceCheckPortalHeader';

export default Header;
