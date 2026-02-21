import { type PartialDeep } from 'type-fest';

import { LOBE_URL_IMPORT_NAME } from '@/const/url';
import { type UserSettings } from '@/types/user/settings';

class ShareService {
  /**
   * Creates a share settings URL with the provided settings.
   * @param settings - The settings object to be encoded in the URL.
   * @returns The share settings URL.
   */
  public createShareSettingsUrl = (settings: PartialDeep<UserSettings>) => {
    return `/?${LOBE_URL_IMPORT_NAME}=${encodeURI(JSON.stringify(settings))}`;
  };

  /**
   * Decode share settings from search params
   * @param settings
   * @returns
   */
  decodeShareSettings = (settings: string) => {
    try {
      return { data: JSON.parse(settings) as PartialDeep<UserSettings> };
    } catch (e) {
      return { message: JSON.stringify(e) };
    }
  };
}

export const shareService = new ShareService();
