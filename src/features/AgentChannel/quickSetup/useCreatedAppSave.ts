import { useState } from 'react';

export interface FeishuCreatedApp {
  appId: string;
  appSecret: string;
  /** The tenant that scanned: a Lark account creates a Lark app. */
  brand: 'feishu' | 'lark';
}

interface UnsavedApp {
  app: FeishuCreatedApp;
  /** Saving here can succeed; an app from the other brand belongs to the other channel. */
  canRetry: boolean;
  message: string;
}

/**
 * Saves an app the scan created. The app already exists and its secret is shown
 * only once, so a failed save keeps the credentials (`unsaved`) for a retry or a
 * manual copy instead of dropping them.
 */
export const useCreatedAppSave = ({
  fallbackMessage,
  onCreated,
  platform,
}: {
  fallbackMessage: string;
  /** Saves the created app; rejects (with a message) when it can't be saved. */
  onCreated: (app: FeishuCreatedApp) => Promise<void>;
  platform: FeishuCreatedApp['brand'];
}) => {
  const [unsaved, setUnsaved] = useState<UnsavedApp>();
  const [saving, setSaving] = useState(false);

  const save = async (app: FeishuCreatedApp) => {
    setSaving(true);
    try {
      await onCreated(app);
      setUnsaved(undefined);
    } catch (error) {
      setUnsaved({
        app,
        canRetry: app.brand === platform,
        message: (error as Error)?.message || fallbackMessage,
      });
    } finally {
      setSaving(false);
    }
  };

  return { clear: () => setUnsaved(undefined), save, saving, unsaved };
};
