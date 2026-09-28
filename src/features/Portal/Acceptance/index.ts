import type { PortalImpl } from '../type';
import Body from './Body';
import Header from './Header';
import Title from './Title';
import { useAcceptanceMoreMenu } from './useMoreMenu';

export const Acceptance: PortalImpl = { Body, Header, Title, useMoreMenu: useAcceptanceMoreMenu };
