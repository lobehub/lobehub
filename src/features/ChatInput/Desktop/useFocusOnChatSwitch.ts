import type { IEditor } from '@lobehub/editor';
import { useEffect } from 'react';

import { isMobileSurface } from '@/utils/mobileSurface';

/**
 * Focus the composer whenever the conversation changes. The mobile SPA renders
 * this composer too, and focusing there pops the keyboard on every topic switch.
 */
export const useFocusOnChatSwitch = (editor: IEditor | undefined, chatKey: string) => {
  useEffect(() => {
    if (editor && !isMobileSurface()) editor.focus();
  }, [chatKey, editor]);
};
