'use client';

import { Flexbox, Icon, Text } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { FolderIcon } from 'lucide-react';
import { memo } from 'react';
import { Trans } from 'react-i18next';

import { projectDirectoryDeviceName } from '@/features/ChatInput/ControlBar/projectDeviceTargets';
import { ExecutionTargetIcon } from '@/features/ExecutionTargetPicker';
import ProjectAvatar from '@/features/Projects/ProjectAvatar';
import { useDeviceList } from '@/store/device';

import { useStagedNewTopicDirectory } from './useStagedNewTopicDirectory';

const styles = stylex.create({
  card: {
    overflow: 'hidden',
    width: '100%',
    paddingBlock: '12px',
    paddingInline: '12px',
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: cssVar.colorBorderSecondary,
    borderRadius: cssVar.borderRadiusLG,
    backgroundColor: cssVar.colorFillQuaternary,
    backgroundImage: 'none',
  },
  path: {
    overflow: 'hidden',
    minWidth: '0',
    fontFamily: cssVar.fontFamilyCode,
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  project: { fontWeight: 600, color: cssVar.colorText },
});

/**
 * Tells a blank conversation opened by a project device group's "+" where its
 * first message will start the topic: the project, the device and the
 * project's directory there. The composer's device chip says the same in
 * short; this is the sentence that makes it read as "a new topic in this
 * project" rather than a stray setting.
 */
const StagedProjectHint = memo(() => {
  const directory = useStagedNewTopicDirectory();
  const { data: devices } = useDeviceList();

  if (!directory) return null;

  return (
    <Flexbox horizontal align={'center'} className={stylex.props(styles.card).className} gap={12}>
      <ProjectAvatar avatar={directory.projectAvatar} name={directory.projectName} size={32} />
      <Flexbox flex={1} gap={2} style={{ minWidth: 0 }}>
        <Text fontSize={14}>
          <Trans
            components={{ project: <span {...stylex.props(styles.project)} /> }}
            i18nKey={'directories.stagedNewTopic'}
            ns={'project'}
            values={{ name: directory.projectName }}
          />
        </Text>
        <Flexbox
          horizontal
          align={'center'}
          gap={6}
          style={{ color: cssVar.colorTextTertiary, fontSize: 12, minWidth: 0 }}
        >
          <ExecutionTargetIcon devicePlatform={directory.platform} target={'device'} />
          <span style={{ flex: 'none' }}>{projectDirectoryDeviceName(directory, devices)}</span>
          <Icon icon={FolderIcon} size={12} style={{ flex: 'none', marginInlineStart: 4 }} />
          <span {...stylex.props(styles.path)} title={directory.path}>
            {directory.path}
          </span>
        </Flexbox>
      </Flexbox>
    </Flexbox>
  );
});

export default StagedProjectHint;
