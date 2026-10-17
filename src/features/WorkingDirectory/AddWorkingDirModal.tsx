'use client';

import type { ModalInstance } from '@lobehub/ui';
import { Button, createModal, cssVar, Flexbox, Input, Text, useModalContext } from '@lobehub/ui';
import { t } from 'i18next';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { deviceService } from '@/services/device';

import { RemoteDirectoryBrowser } from './RemoteDirectoryBrowser';

interface AddWorkingDirContentProps {
  defaultPath?: string;
  deviceId?: string;
  /**
   * Submit the entered path. Return an error message to show inline and keep the
   * modal open; return undefined on success (the modal closes). Lets the caller
   * validate (e.g. statPath) and enrich (repoType) in one round-trip.
   */
  onSubmit: (path: string) => Promise<string | undefined>;
  placeholder?: string;
}

const AddWorkingDirContent = ({
  defaultPath,
  deviceId,
  onSubmit,
  placeholder,
}: AddWorkingDirContentProps) => {
  const { t: tPlugin } = useTranslation('device');
  const { t: tCommon } = useTranslation('common');
  const { close } = useModalContext();
  const [manual, setManual] = useState(!deviceId);
  const [value, setValue] = useState(defaultPath ?? '');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>();
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    queueMicrotask(() => inputRef.current?.focus());
  }, [manual]);

  const handleSubmit = async (path: string) => {
    if (loading) return;
    const next = path.trim();
    if (!next) return;
    setError(undefined);
    setLoading(true);
    try {
      const message = await onSubmit(next);
      if (message) {
        setError(message);
        return;
      }
      close();
    } catch (cause) {
      console.error('Failed to add working directory', cause);
      setError(tPlugin('workingDirectory.addFolderFailed'));
    } finally {
      setLoading(false);
    }
  };

  if (!manual && deviceId) {
    return (
      <RemoteDirectoryBrowser
        defaultPath={value.trim() || undefined}
        deviceId={deviceId}
        error={error}
        loading={loading}
        onCancel={close}
        onSelect={handleSubmit}
        onManual={(path) => {
          setValue(path);
          setError(undefined);
          setManual(true);
        }}
      />
    );
  }

  return (
    <Flexbox gap={16}>
      <Text type={'secondary'}>{tPlugin('workingDirectory.addFolderDesc')}</Text>
      <Flexbox gap={8}>
        {/* `readOnly` while submitting, not `disabled`: Enter submits from this
            focused field, and disabling it inside the modal's focus trap kept
            the page in a busy loop. */}
        <Input
          aria-label={tPlugin('workingDirectory.current')}
          placeholder={placeholder || tPlugin('workingDirectory.placeholder')}
          readOnly={loading}
          ref={inputRef}
          value={value}
          onPressEnter={() => handleSubmit(value)}
          onChange={(e) => {
            setValue(e.target.value);
            setError(undefined);
          }}
        />
        {error ? <Text style={{ color: cssVar.colorError, fontSize: 12 }}>{error}</Text> : null}
      </Flexbox>
      <Flexbox horizontal gap={8} justify={'flex-end'} wrap={'wrap'}>
        {deviceId && (
          <Button
            disabled={loading}
            onClick={() => {
              setError(undefined);
              setManual(false);
            }}
          >
            {tPlugin('workingDirectory.browseFolders')}
          </Button>
        )}
        <Button disabled={loading} onClick={close}>
          {tCommon('cancel')}
        </Button>
        <Button
          disabled={!value.trim()}
          loading={loading}
          type={'primary'}
          onClick={() => handleSubmit(value)}
        >
          {tPlugin('workingDirectory.useFolder')}
        </Button>
      </Flexbox>
    </Flexbox>
  );
};

/** Browse a connected device, with manual entry available as a fallback. */
export const openAddWorkingDirModal = (options: AddWorkingDirContentProps): ModalInstance =>
  createModal({
    content: <AddWorkingDirContent {...options} />,
    footer: null,
    maskClosable: true,
    styles: { header: { borderBottom: 'none' } },
    title: t('workingDirectory.addFolderTitle', { ns: 'device' }),
    width: 'min(90vw, 560px)',
  });

export interface PickedWorkingDir {
  path: string;
  repoType?: 'git' | 'github';
}

/**
 * Open the folder browser for a device and validate the pick there: a definitive
 * "missing" / "not a directory" keeps the modal open with an inline error,
 * otherwise `onPick` receives the path with its detected repoType. An unreachable
 * device (null stat) can't be verified and is let through without a repoType.
 */
export const openPickWorkingDirModal = ({
  defaultPath,
  deviceId,
  onPick,
}: {
  defaultPath?: string;
  deviceId?: string;
  onPick: (entry: PickedWorkingDir) => void | Promise<void>;
}): ModalInstance =>
  openAddWorkingDirModal({
    defaultPath,
    deviceId,
    onSubmit: async (path) => {
      const result = deviceId ? await deviceService.statPath(deviceId, path) : undefined;
      if (result) {
        if (!result.exists) return t('workingDirectory.pathNotExist', { ns: 'device' });
        if (!result.isDirectory) return t('workingDirectory.pathNotDirectory', { ns: 'device' });
      }
      await onPick({ path, repoType: result?.repoType });
      return undefined;
    },
  });
