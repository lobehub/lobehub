'use client';

import { Flexbox } from '@lobehub/ui';
import { Divider } from 'antd';
import { createStaticStyles } from 'antd-style';
import { memo, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import useSWR from 'swr';

import ImperativeModal from '@/components/ImperativeModal';
import { groupKeys } from '@/libs/swr/keys';
import { agentService } from '@/services/agent';

import { type AgentItemData } from './AgentItem';
import AvailableAgentList from './AvailableAgentList';
import SelectedAgentList from './SelectedAgentList';
import { useAgentSelectionStore } from './store';

const styles = createStaticStyles(({ css, cssVar }) => ({
  container: css`
    display: flex;
    flex-direction: row;

    height: 500px;
    padding: 12px;
    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: ${cssVar.borderRadius}px;
  `,
  rightColumn: css`
    display: flex;
    flex: 1;
    flex-direction: column;
  `,
}));

export interface AddGroupMemberModalProps {
  existingMembers?: string[];
  groupId: string;
  onCancel: () => void;
  onConfirm: (selectedAgents: string[]) => void | Promise<void>;
  open: boolean;
}

const AddGroupMemberModal = memo<AddGroupMemberModalProps>(
  ({ existingMembers = [], onCancel, onConfirm, open }) => {
    const { t } = useTranslation(['chat', 'common']);

    const selectedAgentIds = useAgentSelectionStore((s) => s.selectedAgentIds);
    const clearSelection = useAgentSelectionStore((s) => s.clearSelection);

    // Fetch agents from the new API (non-virtual agents only)
    const { data: allAgents = [], isLoading: isLoadingAgents } = useSWR(
      open ? groupKeys.queryAgents() : null,
      () => agentService.queryAgents(),
    );

    // Filter out existing members
    const availableAgents = useMemo<AgentItemData[]>(() => {
      return allAgents.filter((agent) => !existingMembers.includes(agent.id));
    }, [allAgents, existingMembers]);

    // Clear selection when modal closes
    useEffect(() => {
      if (!open) {
        clearSelection();
      }
    }, [open, clearSelection]);

    const [isAdding, setIsAdding] = useState(false);

    const handleConfirm = async () => {
      try {
        setIsAdding(true);
        await onConfirm(selectedAgentIds);
        clearSelection();
      } catch (error) {
        console.error('Failed to add members:', error);
      } finally {
        setIsAdding(false);
      }
    };

    const handleCancel = () => {
      clearSelection();
      onCancel();
    };

    const isConfirmDisabled = selectedAgentIds.length === 0 || isAdding;

    return (
      <ImperativeModal
        allowFullscreen
        okButtonProps={{ disabled: isConfirmDisabled, loading: isAdding }}
        okText={`${t('memberSelection.addMember')} (${selectedAgentIds.length})`}
        open={open}
        title={t('memberSelection.addMember')}
        width={800}
        onCancel={handleCancel}
        onOk={handleConfirm}
      >
        <Flexbox horizontal className={styles.container} gap={8}>
          {/* Left Column - Available Agents */}
          <AvailableAgentList agents={availableAgents} isLoading={isLoadingAgents} />

          <Divider orientation={'vertical'} style={{ height: '100%' }} />

          {/* Right Column - Selected Agents */}
          <SelectedAgentList agents={allAgents} />
        </Flexbox>
      </ImperativeModal>
    );
  },
);

export default AddGroupMemberModal;
