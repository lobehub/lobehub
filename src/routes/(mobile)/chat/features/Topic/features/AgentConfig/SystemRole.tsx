'use client';

import { Flexbox, Skeleton } from '@lobehub/ui';
import { EditableMessage } from '@lobehub/ui/chat';
import { createStaticStyles } from 'antd-style';
import { type MouseEvent } from 'react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import AgentInfo from '@/features/AgentInfo';
import { useOpenChatSettings } from '@/hooks/useInterceptingRoutes';
import { useAgentStore } from '@/store/agent';
import { agentSelectors } from '@/store/agent/selectors';
import { ChatSettingsTabs } from '@/store/global/initialState';

export const styles = createStaticStyles(({ css, cssVar }) => ({
  prompt: css`
    opacity: 0.75;
    transition: opacity 200ms ${cssVar.motionEaseOut};

    &:hover {
      opacity: 1;
    }
  `,
}));

interface SystemRoleProps {
  editing: boolean;
  isLoading: boolean;
  open: boolean;
  setEditing: (value: boolean) => void;
  setOpen: (value: boolean) => void;
}

const SystemRole = memo(({ editing, setEditing, open, setOpen, isLoading }: SystemRoleProps) => {
  const openChatSettings = useOpenChatSettings(ChatSettingsTabs.Prompt);
  const { t } = useTranslation('common');

  const [systemRole, updateAgentConfig, meta] = useAgentStore((s) => [
    agentSelectors.currentAgentSystemRole(s),
    s.updateAgentConfig,
    agentSelectors.currentAgentMeta(s),
  ]);

  const handleOpenWithEdit = (e: MouseEvent) => {
    if (isLoading) return;
    e.stopPropagation();
    setEditing(true);
    setOpen(true);
  };

  const handleOpen = (e: MouseEvent) => {
    if (isLoading) return;
    if (e.altKey) handleOpenWithEdit(e);
    setOpen(true);
  };

  if (isLoading)
    return (
      <Flexbox padding={8}>
        <Skeleton active avatar={false} title={false} />
      </Flexbox>
    );

  return (
    <Flexbox height={200} paddingInline={8} onClick={handleOpen}>
      <EditableMessage
        classNames={{ markdown: styles.prompt }}
        editing={editing}
        markdownProps={{ enableLatex: false, enableMermaid: false }}
        openModal={open}
        placeholder={`${t('settingAgent.prompt.placeholder', { ns: 'setting' })}...`}
        styles={{ markdown: { opacity: systemRole ? undefined : 0.5, overflow: 'visible' } }}
        value={systemRole}
        model={{
          extra: (
            <AgentInfo
              meta={meta}
              style={{ marginBottom: 16 }}
              onAvatarClick={() => {
                setOpen(false);
                setEditing(false);
                openChatSettings();
              }}
            />
          ),
        }}
        text={{
          cancel: t('cancel'),
          confirm: t('ok'),
          edit: t('edit'),
          title: t('settingAgent.prompt.title', { ns: 'setting' }),
        }}
        onEditingChange={setEditing}
        onOpenChange={setOpen}
        onChange={(e) => {
          updateAgentConfig({ systemRole: e });
        }}
      />
    </Flexbox>
  );
});

SystemRole.displayName = 'SystemRole';

export default SystemRole;
