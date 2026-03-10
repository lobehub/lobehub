import { Alert, Flexbox } from '@lobehub/ui';
import path from 'path-browserify-esm';
import { memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { useAgentStore } from '@/store/agent';
import { agentSelectors } from '@/store/agent/selectors';
import { useChatStore } from '@/store/chat';
import { topicSelectors } from '@/store/chat/selectors';

interface OutOfScopeWarningProps {
  /**
   * The path(s) to check
   */
  paths: string[];
}

/**
 * Check if a path is within the working directory
 */
const isPathWithinWorkingDirectory = (targetPath: string, workingDirectory: string): boolean => {
  const normalizedTarget = path.resolve(targetPath);
  const normalizedWorkingDir = path.resolve(workingDirectory);

  return (
    normalizedTarget === normalizedWorkingDir ||
    normalizedTarget.startsWith(normalizedWorkingDir + path.sep)
  );
};

/**
 * Warning component displayed in Intervention UI when paths are outside the working directory
 */
const OutOfScopeWarning = memo<OutOfScopeWarningProps>(({ paths }) => {
  const { t } = useTranslation('tool');

  // Get working directory from topic or agent store
  const topicWorkingDir = useChatStore(topicSelectors.currentTopicWorkingDirectory);
  const agentWorkingDir = useAgentStore(agentSelectors.currentAgentWorkingDirectory);
  const workingDirectory = topicWorkingDir || agentWorkingDir;

  // Find paths that are outside the working directory
  const outsidePaths = useMemo(() => {
    if (!workingDirectory) return [];
    return paths.filter((p) => p && !isPathWithinWorkingDirectory(p, workingDirectory));
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
