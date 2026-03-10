import { LocalSystemManifest } from '@lobechat/builtin-tool-local-system';
import { Flexbox, Icon, Popover, Tooltip } from '@lobehub/ui';
import { createStaticStyles, cx } from 'antd-style';
import { LaptopIcon, SquircleDashed } from 'lucide-react';
import { memo, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useAgentStore } from '@/store/agent';
import { agentByIdSelectors } from '@/store/agent/selectors';
import { useChatStore } from '@/store/chat';
import { topicSelectors } from '@/store/chat/selectors';

import WorkingDirectoryContent from './WorkingDirectoryContent';

const styles = createStaticStyles(({ css, cssVar }) => {
  return {
    base: css`
      border-radius: 6px;
      color: ${cssVar.colorTextTertiary};
      background-color: ${cssVar.colorFillTertiary};

      :hover {
        color: ${cssVar.colorTextSecondary};
        background-color: ${cssVar.colorFillSecondary};
      }
    `,
    filled: css`
      font-family: ${cssVar.fontFamilyCode};
      color: ${cssVar.colorText} !important;
    `,
  };
});

const WorkingDirectory = memo(() => {
  const { t } = useTranslation('plugin');
  const [open, setOpen] = useState(false);

  const agentId = useAgentStore((s) => s.activeAgentId);

  // Check if local-system plugin is enabled for current agent
  const plugins = useAgentStore((s) =>
    agentId ? agentByIdSelectors.getAgentPluginsById(agentId)(s) : [],
  );
  const isLocalSystemEnabled = useMemo(
    () => plugins.includes(LocalSystemManifest.identifier),
    [plugins],
  );

  // Get working directory from Topic (higher priority) or Agent (fallback)
  const topicWorkingDirectory = useChatStore(topicSelectors.currentTopicWorkingDirectory);
  const agentWorkingDirectory = useAgentStore((s) =>
    agentId ? agentByIdSelectors.getAgentWorkingDirectoryById(agentId)(s) : undefined,
  );

  const effectiveWorkingDirectory = topicWorkingDirectory || agentWorkingDirectory;

  // Only show when local-system is enabled and agent exists
  if (!agentId || !isLocalSystemEnabled) return null;

  // Get last folder name for display
  const hasWorkingDirectory = !!effectiveWorkingDirectory;

  const displayName = effectiveWorkingDirectory
    ? effectiveWorkingDirectory.split('/').findLast(Boolean) || effectiveWorkingDirectory
    : t('localSystem.workingDirectory.notSet');

  const content = hasWorkingDirectory ? (
    <Flexbox
      horizontal
      align="center"
      className={cx(styles.base, styles.filled)}
      gap={6}
      style={{ cursor: 'pointer', height: 32, padding: '0 12px' }}
    >
      <Icon icon={LaptopIcon} size={18} />
      <span>{displayName}</span>
    </Flexbox>
  ) : (
    <Flexbox
      horizontal
      align="center"
      className={styles.base}
      gap={6}
      style={{ cursor: 'pointer', height: 32, padding: '0 12px' }}
    >
      <Icon icon={SquircleDashed} size={16} />
      <span>{t('localSystem.workingDirectory.notSet')}</span>
    </Flexbox>
  );
  return (
    <Popover
      content={<WorkingDirectoryContent agentId={agentId} onClose={() => setOpen(false)} />}
      open={open}
      placement="bottomRight"
      trigger="click"
      onOpenChange={setOpen}
    >
      <div>
        {open ? (
          content
        ) : (
          <Tooltip title={effectiveWorkingDirectory || t('localSystem.workingDirectory.notSet')}>
            {content}
          </Tooltip>
        )}
      </div>
    </Popover>
  );
});

WorkingDirectory.displayName = 'WorkingDirectory';

export default WorkingDirectory;
