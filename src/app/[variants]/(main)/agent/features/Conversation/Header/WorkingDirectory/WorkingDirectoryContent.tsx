import { isDesktop } from '@lobechat/const';
import { Flexbox, Icon, Text } from '@lobehub/ui';
import { Button, Divider, Input, Space, Switch } from 'antd';
import { FolderOpen } from 'lucide-react';
import { memo, useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { electronSystemService } from '@/services/electron/system';
import { useAgentStore } from '@/store/agent';
import { agentByIdSelectors } from '@/store/agent/selectors';
import { useChatStore } from '@/store/chat';
import { topicSelectors } from '@/store/chat/selectors';

interface WorkingDirectoryContentProps {
  agentId: string;
  onClose?: () => void;
}

const WorkingDirectoryContent = memo<WorkingDirectoryContentProps>(({ agentId, onClose }) => {
  const { t } = useTranslation('plugin');

  // Get current values
  const agentWorkingDirectory = useAgentStore((s) =>
    agentByIdSelectors.getAgentWorkingDirectoryById(agentId)(s),
  );
  const topicWorkingDirectory = useChatStore(topicSelectors.currentTopicWorkingDirectory);
  const activeTopicId = useChatStore((s) => s.activeTopicId);

  // Actions
  const updateAgentLocalSystemConfig = useAgentStore((s) => s.updateAgentLocalSystemConfigById);
  const updateTopicMetadata = useChatStore((s) => s.updateTopicMetadata);

  // Local state for editing
  const [agentDir, setAgentDir] = useState(agentWorkingDirectory || '');
  const [topicDir, setTopicDir] = useState(topicWorkingDirectory || '');
  const [useTopicOverride, setUseTopicOverride] = useState(!!topicWorkingDirectory);
  const [loading, setLoading] = useState(false);

  const handleSelectAgentFolder = useCallback(async () => {
    if (!isDesktop) return;
    const folder = await electronSystemService.selectFolder({
      defaultPath: agentDir || undefined,
      title: t('localSystem.workingDirectory.selectFolder'),
    });
    if (folder) setAgentDir(folder);
  }, [agentDir, t]);

  const handleSelectTopicFolder = useCallback(async () => {
    if (!isDesktop) return;
    const folder = await electronSystemService.selectFolder({
      defaultPath: topicDir || undefined,
      title: t('localSystem.workingDirectory.selectFolder'),
    });
    if (folder) setTopicDir(folder);
  }, [topicDir, t]);

  const handleSave = useCallback(async () => {
    setLoading(true);
    try {
      // Save agent working directory
      await updateAgentLocalSystemConfig(agentId, {
        workingDirectory: agentDir || undefined,
      });

      // Save topic working directory if override is enabled
      if (activeTopicId && useTopicOverride) {
        await updateTopicMetadata(activeTopicId, {
          workingDirectory: topicDir || undefined,
        });
      } else if (activeTopicId && !useTopicOverride && topicWorkingDirectory) {
        // Clear topic override if disabled
        await updateTopicMetadata(activeTopicId, {
          workingDirectory: undefined,
        });
      }

      onClose?.();
    } finally {
      setLoading(false);
    }
  }, [
    agentId,
    agentDir,
    activeTopicId,
    useTopicOverride,
    topicDir,
    topicWorkingDirectory,
    updateAgentLocalSystemConfig,
    updateTopicMetadata,
    onClose,
  ]);

  return (
    <Flexbox gap={12} style={{ maxWidth: 600, minWidth: 320 }}>
      <Flexbox gap={4}>
        <Text style={{ fontSize: 12 }} type="secondary">
          {t('localSystem.workingDirectory.agentLevel')}
        </Text>
        <Flexbox gap={8} horizontal>
          <Input
            onChange={(e) => setAgentDir(e.target.value)}
            placeholder={t('localSystem.workingDirectory.placeholder')}
            size="small"
            style={{ flex: 1, fontSize: 12 }}
            value={agentDir}
            variant={'filled'}
          />
          {isDesktop && (
            <Button onClick={handleSelectAgentFolder} size="small" type={'text'}>
              <Icon icon={FolderOpen} size={14} />
            </Button>
          )}
        </Flexbox>
      </Flexbox>

      {activeTopicId && (
        <>
          <Divider style={{ margin: 0 }} />

          <Flexbox
            align="center"
            gap={8}
            horizontal
            onClick={() => {
              setUseTopicOverride(!useTopicOverride);
            }}
            style={{ cursor: 'pointer' }}
          >
            <Switch checked={useTopicOverride} onChange={setUseTopicOverride} size="small" />
            <Text style={{ fontSize: 12 }}>{t('localSystem.workingDirectory.topicOverride')}</Text>
          </Flexbox>

          {useTopicOverride && (
            <Flexbox gap={4}>
              <Text style={{ fontSize: 12 }} type="secondary">
                {t('localSystem.workingDirectory.topicLevel')}
              </Text>
              <Flexbox gap={8} horizontal>
                <Input
                  onChange={(e) => setTopicDir(e.target.value)}
                  placeholder={t('localSystem.workingDirectory.placeholder')}
                  size="small"
                  style={{ flex: 1, fontSize: 12 }}
                  value={topicDir}
                  variant={'filled'}
                />
                {isDesktop && (
                  <Button onClick={handleSelectTopicFolder} size="small" type={'text'}>
                    <Icon icon={FolderOpen} size={14} />
                  </Button>
                )}
              </Flexbox>
            </Flexbox>
          )}
        </>
      )}

      <Flexbox horizontal justify="flex-end">
        <Space>
          <Button onClick={onClose} size="small">
            {t('cancel', { ns: 'common' })}
          </Button>
          <Button loading={loading} onClick={handleSave} size="small" type="primary">
            {t('save', { ns: 'common' })}
          </Button>
        </Space>
      </Flexbox>
    </Flexbox>
  );
});

WorkingDirectoryContent.displayName = 'WorkingDirectoryContent';

export default WorkingDirectoryContent;
