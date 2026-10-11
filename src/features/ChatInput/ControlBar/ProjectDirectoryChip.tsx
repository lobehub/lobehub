'use client';

import { Tooltip } from '@lobehub/ui';
import { cx } from 'antd-style';
import { useTranslation } from 'react-i18next';

import DirIcon from './DirIcon';
import { useProjectTopicDirectory } from './useProjectTopicDirectory';
import { workingDirectoryChipStyles } from './workingDirectoryChipStyles';

interface ProjectDirectoryChipProps {
  topicId: string;
}

/**
 * The working directory of a project-directory conversation. It belongs to the
 * project, so it is shown but not picked here — switching devices
 * (`ProjectDeviceSwitcher`) is what moves the conversation to the project's
 * directory on another machine.
 */
const ProjectDirectoryChip = ({ topicId }: ProjectDirectoryChipProps) => {
  const { t } = useTranslation('project');
  const { directory } = useProjectTopicDirectory(topicId);
  if (!directory) return null;

  return (
    <Tooltip title={t('directories.boundTip', { path: directory.path })}>
      <div className={cx(workingDirectoryChipStyles.chip, workingDirectoryChipStyles.readonly)}>
        <DirIcon />
        <span className={workingDirectoryChipStyles.label}>{directory.name}</span>
      </div>
    </Tooltip>
  );
};

export default ProjectDirectoryChip;
