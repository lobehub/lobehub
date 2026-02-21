'use client';

import { Flexbox } from '@lobehub/ui';
import { EditableMessage } from '@lobehub/ui/chat';
import { type MouseEvent } from 'react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import GroupInfo from '@/features/GroupInfo';
import { useAgentGroupStore } from '@/store/agentGroup';
import { agentGroupSelectors } from '@/store/agentGroup/selectors';
import { type LobeSession } from '@/types/session';

import { styles } from './style';

interface GroupRoleProps {
  currentSession?: LobeSession;
  editing: boolean;
  editorModalOpen: boolean;
  setEditing: (editing: boolean) => void;
  setEditorModalOpen: (open: boolean) => void;
}

const GroupRole = memo<GroupRoleProps>(
  ({ currentSession, editorModalOpen, setEditorModalOpen, setEditing, editing }) => {
    const { t } = useTranslation('chat');

    const activeGroupId = useAgentGroupStore((s) => s.activeGroupId);
    const updateGroupConfig = useAgentGroupStore((s) => s.updateGroupConfig);
    const groupConfig = useAgentGroupStore(agentGroupSelectors.currentGroupConfig);

    const handleSystemPromptChange = async (value: string) => {
      if (!activeGroupId) return;
      await updateGroupConfig({ systemPrompt: value });
    };

    const handleOpenWithEdit = (e: MouseEvent) => {
      e.stopPropagation();
      setEditing(true);
      setEditorModalOpen(true);
    };

    const handleOpen = (e: MouseEvent) => {
      e.stopPropagation();
      if (editorModalOpen) return;
      if (e.altKey) handleOpenWithEdit(e);
      setEditorModalOpen(true);
    };

    return (
      <Flexbox height={200} paddingInline={8} onClick={handleOpen}>
        <EditableMessage
          classNames={{ markdown: styles.prompt }}
          editing={editing}
          markdownProps={{ enableLatex: false, enableMermaid: false }}
          openModal={editorModalOpen}
          placeholder={`${t('settingGroup.systemPrompt.placeholder', { ns: 'setting' })}...`}
          value={groupConfig?.systemPrompt || ''}
          model={{
            extra: <GroupInfo meta={currentSession?.meta} style={{ marginBottom: 16 }} />,
          }}
          styles={{
            markdown: {
              opacity: groupConfig?.systemPrompt ? undefined : 0.5,
              overflow: 'visible',
            },
          }}
          text={{
            cancel: t('cancel', { ns: 'common' }),
            confirm: t('ok', { ns: 'common' }),
            edit: t('edit', { ns: 'common' }),
            title: t('settingGroup.systemPrompt.title', { ns: 'setting' }),
          }}
          onChange={handleSystemPromptChange}
          onEditingChange={setEditing}
          onOpenChange={setEditorModalOpen}
        />
      </Flexbox>
    );
  },
);

GroupRole.displayName = 'GroupRole';

export default GroupRole;
