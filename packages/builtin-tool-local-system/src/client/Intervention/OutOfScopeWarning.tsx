import { isPathWithinScope } from '@lobechat/tool-runtime';
import { Flexbox } from '@lobehub/ui';
import { Alert } from '@lobehub/ui/base-ui';
import { memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { useCurrentAgentWorkingDirectory } from '@/store/agent/projection';
import { useChatTopicWorkingDirectory } from '@/store/chat/slices/topic/projection';
import { useElectronStore } from '@/store/electron';

interface OutOfScopeWarningProps {
  /**
   * The path(s) to check
   */
  paths: string[];
}

/**
 * Warning component displayed in Intervention UI when paths are outside the working directory
 */
const OutOfScopeWarning = memo<OutOfScopeWarningProps>(({ paths }) => {
  const { t } = useTranslation('tool');

  const topicWorkingDir = useChatTopicWorkingDirectory();
  const currentDeviceId = useElectronStore((s) => s.gatewayDeviceInfo?.deviceId);
  const agentWorkingDir = useCurrentAgentWorkingDirectory(currentDeviceId);
  const workingDirectory = topicWorkingDir || agentWorkingDir;

  // Find paths that are outside the working directory
  const outsidePaths = useMemo(() => {
    if (!workingDirectory) return [];
    return paths.filter((p) => p && !isPathWithinScope(p, workingDirectory));
  }, [paths, workingDirectory]);

  // Don't render if no working directory set or all paths are within scope
  if (!workingDirectory || outsidePaths.length === 0) {
    return null;
  }

  return (
    <Alert
      showIcon
      title={t('localFiles.outOfScope.warning')}
      type="warning"
      variant="borderless"
      description={
        <Flexbox gap={4} style={{ fontSize: 12 }}>
          <div>
            <strong>{t('localFiles.outOfScope.workingDirectory')}:</strong>{' '}
            <code>{workingDirectory}</code>
          </div>
          <div>
            <strong>{t('localFiles.outOfScope.requestedPaths')}:</strong>
          </div>
          <ul style={{ margin: 0, paddingLeft: 20 }}>
            {outsidePaths.map((p, i) => (
              <li key={i}>
                <code>{p}</code>
              </li>
            ))}
          </ul>
        </Flexbox>
      }
    />
  );
});

OutOfScopeWarning.displayName = 'OutOfScopeWarning';

export default OutOfScopeWarning;
