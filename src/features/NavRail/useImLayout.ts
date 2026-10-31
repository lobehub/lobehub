import { useEffect } from 'react';

import { featureFlagsSelectors, useServerConfigStore } from '@/store/serverConfig';

import { writeImLayoutHint } from './layoutHint';

/** Runtime flag `im_layout`: the rail layout trial. Off keeps the sidebar layout. */
export const useImLayout = (): boolean =>
  useServerConfigStore((s) => !!featureFlagsSelectors(s).enableImLayout);

/** Remember the rendered layout so the next boot skeleton matches it. */
export const useSyncImLayoutHint = (enabled: boolean) => {
  useEffect(() => writeImLayoutHint(enabled), [enabled]);
};
