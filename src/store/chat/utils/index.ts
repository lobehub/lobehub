import { isDesktop } from '@lobechat/const';
import i18n from 'i18next';
import { produce } from 'immer';

export const preventLeavingFn = (e: BeforeUnloadEvent) => {
  // On desktop the main process manages window close / app quit (keepAlive + isQuiting),
  // so the browser "are you sure you want to leave" guard is unnecessary here — and it can
  // block window.close() during auto-update, leaving the app unable to quit & install.
  if (isDesktop) return;

  // set returnValue to trigger alert modal
  // Note: No matter what value is set, the browser will display the standard text
  e.returnValue = i18n.t('beforeUnload.confirmLeave', { ns: 'chat' });
};

export const toggleBooleanList = (ids: string[], id: string, loading: boolean) => {
  return produce(ids, (draft) => {
    if (loading) {
      if (!draft.includes(id)) draft.push(id);
    } else {
      const index = draft.indexOf(id);

      if (index >= 0) draft.splice(index, 1);
    }
  });
};
