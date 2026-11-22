import { matchChannelThread } from '@/features/Channels/paths';

/**
 * Whether the title bar drops its device and cloud status icons for this page. A Channel thread
 * page's header carries its own row of actions right under that corner, so the two icons above
 * it read as a second, duplicate toolbar.
 */
export const isStatusHidden = (pathname: string): boolean => !!matchChannelThread(pathname);
