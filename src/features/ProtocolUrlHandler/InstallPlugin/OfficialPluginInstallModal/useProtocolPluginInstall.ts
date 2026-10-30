import { useEffect, useRef, useState } from 'react';

interface ProtocolPluginInstallOptions {
  cancel: () => Promise<void>;
  enable: () => Promise<void>;
  install: () => Promise<boolean | undefined>;
  installed: boolean;
  onComplete: () => void;
  onError: (error: unknown) => void;
}

/** Keep a protocol request alive across authorization, configuration and dependency pauses. */
export const useProtocolPluginInstall = ({
  cancel,
  enable,
  install,
  installed,
  onComplete,
  onError,
}: ProtocolPluginInstallOptions) => {
  const [loading, setLoading] = useState(false);
  const pending = useRef(false);
  const mounted = useRef(false);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      if (pending.current) {
        pending.current = false;
        void cancel();
      }
    };
  }, [cancel]);

  useEffect(() => {
    // The store refreshes the installed-plugin list only after the server accepts the install.
    // This also observes successful continuations initiated inside MCPInstallProgress.
    if (!installed || !pending.current) return;
    pending.current = false;
    void (async () => {
      try {
        await enable();
        if (mounted.current) onComplete();
      } catch (error) {
        if (mounted.current) onError(error);
      }
    })();
  }, [installed, enable, onComplete, onError]);

  const confirm = async () => {
    if (installed || loading) return;
    pending.current = true;
    setLoading(true);
    try {
      await install();
    } catch (error) {
      if (mounted.current) onError(error);
    } finally {
      if (mounted.current) setLoading(false);
    }
  };

  const dismiss = () => {
    pending.current = false;
    void cancel();
  };

  return { confirm, dismiss, loading };
};
