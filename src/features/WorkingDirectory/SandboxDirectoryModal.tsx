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
  useModalContext,
} from '@lobehub/ui';
import { t } from 'i18next';
import { LockIcon, UsersIcon } from 'lucide-react';
import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { SandboxStorageUpgradeGuide } from '@/business/client/features/SandboxStorageUpsell';
import { useSandboxDriveEntitlement } from '@/hooks/useSandboxDriveEntitlement';

import { DirectoryBrowser } from './DirectoryBrowser';
import { useSandboxDirectorySource } from './sources/useSandboxDirectorySource';

/** What a pick on the drive binds the conversation to, and which drive it is on. */
export type SandboxDirectoryPick = { drive: SandboxDrive } & (
  { instanceId: string } | { workingDirectory: string }
);

interface SandboxDirectoryContentProps {
  agentIsPublic?: boolean;
  defaultPath?: string;
  /** The drive to open on; the conversation's own, or the public one in a workspace. */
  drive?: SandboxDrive;
  /** In a workspace: a public drive beside the member's personal one. */
  isWorkspace: boolean;
  onPick: (pick: SandboxDirectoryPick) => void | Promise<void>;
  topicId?: string;
}

const SandboxDirectoryContent = ({
  agentIsPublic,
  defaultPath,
  drive: initialDrive,
  isWorkspace,
  onPick,
  topicId,
}: SandboxDirectoryContentProps) => {
  const { t: tDevice } = useTranslation('device');
  const { close } = useModalContext();
  const { entitled } = useSandboxDriveEntitlement();
  const [drive, setDrive] = useState<SandboxDrive>(
    isWorkspace ? (initialDrive ?? 'public') : 'personal',
  );
  // A path belongs to the drive it was picked on; another drive opens at its root.
  const startPath =
    drive === (initialDrive ?? (isWorkspace ? 'public' : 'personal')) ? defaultPath : undefined;

  const onPickInstance = useCallback(
    (instanceId: string, instanceDrive: SandboxDrive) => {
      close();
      void onPick({ drive: instanceDrive, instanceId });
    },
    [close, onPick],
  );

  const source = useSandboxDirectorySource({
    agentIsPublic,
    drive,
    isWorkspace,
    onPickInstance,
    topicId,
  });

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
          drive means nothing on the other. No description: the drive switch
          and the breadcrumb already say where this is. */}
      <DirectoryBrowser
        defaultPath={startPath}
        description={null}
        key={drive}
        loading={false}
        source={source}
        onCancel={close}
        onSelect={(path) => {
          close();
          // The root is a choice of its own — `.` — distinct from "no folder",
          // which is the temporary sandbox.
          void onPick({ drive, workingDirectory: path || '.' });
        }}
      />
    </Flexbox>
  );
};

/**
 * Pick where a cloud-sandbox conversation works on the drive: a folder, the
 * root (personal drives only), or an environment directory — or initialize a
 * new folder from a code environment. In a workspace the public and personal
 * drives are switched between at the top.
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
