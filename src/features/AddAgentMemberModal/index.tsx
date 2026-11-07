'use client';

import { Divider, Flexbox } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { memo, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import ImperativeModal from '@/components/ImperativeModal';

import AvailableAgentList from './AvailableAgentList';
import SelectedAgentList from './SelectedAgentList';
import { useAgentSelectionStore } from './store';
import { useAddableGroupMembers } from './useAddableGroupMembers';

const styles = stylex.create({
  container: {
    display: 'flex',
    flexDirection: 'row',
    height: '500px',
    padding: '12px',
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: cssVar.colorBorderSecondary,
    borderRadius: `${cssVar.borderRadius}px`,
  },
});

/** Multi-select agent picker shared by chat groups and projects. */
export interface AddGroupMemberModalProps {
  existingMembers?: string[];
  groupId?: string;
  onCancel: () => void;
  onConfirm: (selectedAgents: string[]) => void | Promise<void>;
  open: boolean;
  /** Offer only agents every workspace member can see, e.g. for a shared project. */
  sharedOnly?: boolean;
}

const AddGroupMemberModal = memo<AddGroupMemberModalProps>(
  ({ existingMembers = [], onCancel, onConfirm, open, sharedOnly }) => {
    const { t } = useTranslation(['chat', 'common']);

    const selectedAgentIds = useAgentSelectionStore((s) => s.selectedAgentIds);
    const clearSelection = useAgentSelectionStore((s) => s.clearSelection);

    const {
      allAgents,
      availableAgents,
      isLoading: isLoadingAgents,
    } = useAddableGroupMembers(existingMembers, { sharedOnly });

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
        <Flexbox horizontal className={stylex.props(styles.container).className} gap={8}>
          {/* Left Column - Available Agents */}
          <AvailableAgentList agents={availableAgents} isLoading={isLoadingAgents} />

          <Divider orientation={'vertical'} style={{ height: '100%', marginInline: 8 }} />

          {/* Right Column - Selected Agents */}
          <SelectedAgentList agents={allAgents} />
        </Flexbox>
      </ImperativeModal>
    );
  },
);

export default AddGroupMemberModal;
