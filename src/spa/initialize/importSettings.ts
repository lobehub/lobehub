import { LOBE_URL_IMPORT_NAME } from '@/const/url';
import { getUserStoreState, useUserStore } from '@/store/user';

let importSettingsStarted = false;
let pendingSettings: string | null = null;
let unsubscribeUserState: (() => void) | undefined;

const clearUserStateSubscription = () => {
  unsubscribeUserState?.();
  unsubscribeUserState = undefined;
};

const readImportSettingsFromUrl = (): string | null => {
  if (typeof window === 'undefined') return null;

  const params = new URLSearchParams(window.location.search);
  const settings = params.get(LOBE_URL_IMPORT_NAME);
  if (!settings) return null;

  params.delete(LOBE_URL_IMPORT_NAME);
  const search = params.toString();
  const nextUrl = `${window.location.pathname}${search ? `?${search}` : ''}${window.location.hash}`;
  window.history.replaceState({}, '', nextUrl);

  return settings;
};

const tryImportSettings = () => {
  if (!pendingSettings) return;

  const { importUrlShareSettings, isUserStateInit } = getUserStoreState();
  if (!isUserStateInit) return;

  const settings = pendingSettings;
  pendingSettings = null;
  clearUserStateSubscription();

  void importUrlShareSettings(settings);
};

export const startImportSettingsFromUrl = () => {
  if (importSettingsStarted) return;
  importSettingsStarted = true;

  pendingSettings = readImportSettingsFromUrl();
  if (!pendingSettings) return;

  tryImportSettings();
  if (pendingSettings) {
    unsubscribeUserState = useUserStore.subscribe(
      (state) => state.isUserStateInit,
      tryImportSettings,
    );
  }
};
