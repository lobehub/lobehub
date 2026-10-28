import { isValidDirectoryName, isWindowsDevicePath } from '@lobechat/utils/directoryName';
import { toast } from '@lobehub/ui';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

export { isValidDirectoryName as isValidFolderName } from '@lobechat/utils/directoryName';

const ERROR_MESSAGE_KEYS = {
  // The name is taken on the device.
  CONFLICT: 'workingDirectory.newFolderExists',
  // The device app predates folder creation.
  PRECONDITION_FAILED: 'workingDirectory.newFolderUnsupported',
} as const;

const getErrorMessageKey = (error: unknown) => {
  const code = (error as { data?: { code?: string } })?.data?.code;
  return code && code in ERROR_MESSAGE_KEYS
    ? ERROR_MESSAGE_KEYS[code as keyof typeof ERROR_MESSAGE_KEYS]
    : 'workingDirectory.newFolderFailed';
};

interface UseCreateFolderOptions {
  /** Makes the folder wherever the picker is browsing — a device, or the drive. */
  create: (parentPath: string, name: string) => Promise<{ path: string }>;
  /** A source's own reading of an error it threw; the generic one otherwise. */
  errorMessageKey?: (error: unknown) => string | undefined;
  onCreated: (path: string) => void;
  parentPath: string;
}

/** Name + create one folder inside the folder a remote picker is browsing. */
export const useCreateFolder = ({
  create,
  errorMessageKey,
  onCreated,
  parentPath,
}: UseCreateFolderOptions) => {
  const { t } = useTranslation('device');
  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const [name, setNameState] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();

  const setName = (value: string) => {
    setNameState(value);
    setError(undefined);
  };

  const submit = async () => {
    if (pending) return;
    const next = name.trim();
    if (!next) return;
    if (!isValidDirectoryName(name, parentPath) || !isValidDirectoryName(next, parentPath)) {
      setError(
        t(
          isWindowsDevicePath(parentPath)
            ? 'workingDirectory.newFolderInvalidWindowsName'
            : 'workingDirectory.newFolderInvalidName',
        ),
      );
      return;
    }

    setError(undefined);
    setPending(true);
    try {
      const result = await create(parentPath, next);
      if (mounted.current) onCreated(result.path);
      else toast.success(t('workingDirectory.newFolderCreated', { path: result.path }));
    } catch (cause) {
      console.error('Failed to create folder', cause);
      const message = t((errorMessageKey?.(cause) ?? getErrorMessageKey(cause)) as any);
      if (mounted.current) setError(message);
      else toast.error(message);
    } finally {
      if (mounted.current) setPending(false);
    }
  };

  return { error, name, pending, setName, submit };
};
