import { toast } from '@lobehub/ui/base-ui';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useFileStore } from '@/store/file';

const MAX_LOGO_SIZE = 2 * 1024 * 1024;

/**
 * Uploads an app logo to file storage and returns its absolute URL.
 *
 * The logo ends up as the OIDC client's `logo_uri`, which oidc-provider only
 * accepts as a web URI; a `data:` URI makes the provider reject the whole
 * client. So the image goes to storage, never inline into the record.
 */
export const useLogoUpload = () => {
  const { t } = useTranslation('auth');
  const uploadWithProgress = useFileStore((s) => s.uploadWithProgress);
  const [uploading, setUploading] = useState(false);

  const upload = async (file: File): Promise<string | undefined> => {
    if (file.size > MAX_LOGO_SIZE) {
      toast.error(t('oauthApp.form.logo.tooLarge'));
      return;
    }

    setUploading(true);
    try {
      const result = await uploadWithProgress({ file });
      if (!result?.url) {
        toast.error(t('oauthApp.form.logo.uploadFailed'));
        return;
      }

      // Local storage returns a path; the provider needs an absolute URL.
      return result.url.startsWith('/') ? `${window.location.origin}${result.url}` : result.url;
    } catch (error) {
      console.error('[OAuthApps] Logo upload failed:', error);
      toast.error(t('oauthApp.form.logo.uploadFailed'));
    } finally {
      setUploading(false);
    }
  };

  return { upload, uploading };
};
