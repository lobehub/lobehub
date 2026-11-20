'use client';

import type { SandboxDrive } from '@lobechat/builtin-tool-cloud-sandbox';
import {
  Center,
  createModal,
  Flexbox,
  Icon,
  type ModalInstance,
  Segmented,
  Spin,
  toast,
  useModalContext,
} from '@lobehub/ui';
import { t } from 'i18next';
import { LockIcon, UsersIcon } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { SandboxStorageUpgradeGuide } from '@/business/client/features/SandboxStorageUpsell';
import { useSandboxDriveEntitlement } from '@/hooks/useSandboxDriveEntitlement';

import { confirmPick } from './confirmPick';
import { DirectoryBrowser } from './DirectoryBrowser';
import { useSandboxDirectorySource } from './sources/useSandboxDirectorySource';

/** The folder a pick on the drive binds the conversation to, and which drive it is on. */
export interface SandboxDirectoryPick {
  drive: SandboxDrive;
  workingDirectory: string;
}

interface SandboxDirectoryContentProps {
  defaultPath?: string;
  /** The drive to open on; the conversation's own, or the public one in a workspace. */
  drive?: SandboxDrive;
  /** In a workspace: a public drive beside the member's personal one. */
  isWorkspace: boolean;
  onPick: (pick: SandboxDirectoryPick) => void | Promise<void>;
}

const SandboxDirectoryContent = ({
  defaultPath,
  drive: initialDrive,
  isWorkspace,
  onPick,
}: SandboxDirectoryContentProps) => {
  const { t: tDevice } = useTranslation('device');
  const { close } = useModalContext();
  const { entitled } = useSandboxDriveEntitlement();
  const [saving, setSaving] = useState(false);
  const [drive, setDrive] = useState<SandboxDrive>(
    isWorkspace ? (initialDrive ?? 'public') : 'personal',
  );
  // A path belongs to the drive it was picked on; another drive opens at its root.
  const startPath =
    drive === (initialDrive ?? (isWorkspace ? 'public' : 'personal')) ? defaultPath : undefined;

  const source = useSandboxDirectorySource({ drive, isWorkspace });

  // Without a drive there is nothing to browse: the way to one stands where
  // the folders would be.
  if (entitled === false) return <SandboxStorageUpgradeGuide compact onLeave={close} />;
  if (entitled === undefined) {
    return (
      <Center style={{ minHeight: 240 }}>
        <Spin />
      </Center>
    );
  }

  return (
    <Flexbox gap={12}>
      {isWorkspace && (
        <Segmented
          block
          value={drive}
          options={[
            {
              icon: <Icon icon={UsersIcon} />,
              label: tDevice('workingDirectory.drive.drives.public'),
              value: 'public',
            },
            {
              icon: <Icon icon={LockIcon} />,
              label: tDevice('workingDirectory.drive.drives.personal'),
              value: 'personal',
            },
          ]}
          onChange={(value) => setDrive(value as SandboxDrive)}
        />
      )}
      {/* Keyed on the drive, so its navigation starts over: a folder on one
          drive means nothing on the other. */}
      <DirectoryBrowser
        defaultPath={startPath}
        description={tDevice('workingDirectory.drive.browseDescription')}
        key={drive}
        loading={saving}
        source={source}
        onCancel={close}
        onSelect={async (path) => {
          setSaving(true);
          await confirmPick({
            // The root is a choice of its own — `.` — distinct from "no
            // folder", which is the temporary sandbox.
            apply: () => onPick({ drive, workingDirectory: path || '.' }),
            close,
            fail: () => toast.error(tDevice('workingDirectory.drive.pickFailed')),
          });
          setSaving(false);
        }}
      />
    </Flexbox>
  );
};

/**
 * Pick the folder on the drive a cloud-sandbox conversation works in — any
 * folder, or the root of a personal drive — laid out like a device's folder
 * picker: a toolbar and the path, the folders below. In a workspace the public
 * and personal drives are switched between at the top.
 */
export const openSandboxDirectoryModal = (props: SandboxDirectoryContentProps): ModalInstance =>
  createModal({
    content: <SandboxDirectoryContent {...props} />,
    footer: null,
    maskClosable: true,
    styles: { header: { borderBottom: 'none' } },
    title: t('workingDirectory.drive.title', { ns: 'device' }),
    width: 'min(90vw, 600px)',
  });
