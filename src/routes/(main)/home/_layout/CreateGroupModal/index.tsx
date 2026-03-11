'use client';

import { Button, Flexbox, Modal, stopPropagation } from '@lobehub/ui';
import { App } from 'antd';
import { createStaticStyles } from 'antd-style';
import { memo, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import useSWR from 'swr';

import { agentService } from '@/services/agent';
import { useGlobalStore } from '@/store/global';
import { useHomeStore } from '@/store/home';

import { type AgentItemData } from './AgentItem';
import AvailableAgentList from './AvailableAgentList';
import SelectedAgentList from './SelectedAgentList';
import { useAgentSelectionStore } from './store';

const styles = createStaticStyles(({ css, cssVar }) => ({
  container: css`
    display: flex;
    flex-direction: row;

    height: 500px;
    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: ${cssVar.borderRadius};
  `,
  rightColumn: css`
    display: flex;
    flex: 1;
    flex-direction: column;
  `,
}));

export interface CreateGroupModalProps {
  id: string;
  onCancel: () => void;
  open: boolean;
}

const CreateGroupModal = memo<CreateGroupModalProps>(({ id, onCancel, open }) => {
  const { t } = useTranslation(['chat', 'common']);
  const { message } = App.useApp();

  const toggleExpandSessionGroup = useGlobalStore((s) => s.toggleExpandSessionGroup);
  const [updateAgentGroup, addGroup] = useHomeStore((s) => [s.updateAgentGroup, s.addGroup]);

  const [groupName, setGroupName] = useState('');
  const [isCreating, setIsCreating] = useState(false);

  const selectedAgentIds = useAgentSelectionStore((s) => s.selectedAgentIds);
  const setSelectedAgents = useAgentSelectionStore((s) => s.setSelectedAgents);
  const clearSelection = useAgentSelectionStore((s) => s.clearSelection);

  // Fetch all agents
  const { data: allAgents = [], isLoading: isLoadingAgents } = useSWR<AgentItemData[]>(
    open ? 'queryAgentsForCreateGroup' : null,
    () => agentService.queryAgents(),
  );

  // Clear state when modal closes
  useEffect(() => {
    if (!open) {
      setGroupName('');
      clearSelection();
    }
  }, [open, clearSelection]);

  // Pre-select the initial agent when modal opens
  useEffect(() => {
    if (open && id) {
      setSelectedAgents([id]);
    }
  }, [open, id, setSelectedAgents]);

  const handleConfirm = async () => {
    if (groupName.length === 0 || groupName.length > 20 || groupName.trim() === '') {
      message.warning(t('sessionGroup.tooLong'));
      return;
    }

    if (selectedAgentIds.length === 0) {
      message.warning(t('sessionGroup.noSelectedAgents'));
      return;
    }

    try {
      setIsCreating(true);
      const groupId = await addGroup(groupName);

      // Move all selected agents to the new group
      await Promise.all(selectedAgentIds.map((agentId) => updateAgentGroup(agentId, groupId)));

      toggleExpandSessionGroup(groupId, true);
      message.success(t('sessionGroup.createSuccess'));
      clearSelection();
      onCancel();
    } catch (error) {
      console.error('Failed to create group:', error);
    } finally {
      setIsCreating(false);
    }
  };

  const handleCancel = () => {
    setGroupName('');
    clearSelection();
    onCancel();
  };

  const isConfirmDisabled = groupName.trim() === '' || selectedAgentIds.length === 0 || isCreating;

  return (
    <div onClick={stopPropagation}>
      <Modal
        allowFullscreen
        destroyOnHidden
        open={open}
        title={t('sessionGroup.createGroup')}
        width={800}
        footer={
          <Flexbox horizontal gap={8} justify="end">
            <Button onClick={handleCancel}>{t('cancel', { ns: 'common' })}</Button>
            <Button
              disabled={isConfirmDisabled}
              loading={isCreating}
              type="primary"
              onClick={handleConfirm}
            >
              {t('sessionGroup.createGroup')}
            </Button>
          </Flexbox>
        }
        onCancel={handleCancel}
      >
        <Flexbox horizontal className={styles.container}>
          {/* Left Column - Available Agents */}
          <AvailableAgentList agents={allAgents} isLoading={isLoadingAgents} />

          {/* Right Column - Selected Agents and Group Name */}
          <Flexbox className={styles.rightColumn}>
            <SelectedAgentList
              agents={allAgents}
              groupName={groupName}
              onGroupNameChange={setGroupName}
            />
          </Flexbox>
        </Flexbox>
      </Modal>
    </div>
  );
});

export default CreateGroupModal;
