'use client';

import HeteroDeviceSwitcher from './HeteroDeviceSwitcher';
import ProjectDeviceSwitcher from './ProjectDeviceSwitcher';
import { useActiveProjectDirectoryTopicId } from './useProjectTopicDirectory';

interface DeviceSwitcherProps {
  agentId: string;
}

/**
 * The execution-device control for whichever conversation is open. A
 * project-directory conversation runs in its project's directory, so it only
 * chooses among the project's devices; everything else gets the general
 * execution-target picker. Every bar that shows a device control mounts this,
 * so no surface can fall back to the general picker for a project topic.
 */
const DeviceSwitcher = ({ agentId }: DeviceSwitcherProps) => {
  const projectTopicId = useActiveProjectDirectoryTopicId();

  return projectTopicId ? (
    <ProjectDeviceSwitcher agentId={agentId} topicId={projectTopicId} />
  ) : (
    <HeteroDeviceSwitcher agentId={agentId} />
  );
};

export default DeviceSwitcher;
