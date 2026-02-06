'use client';

import { Button, Flexbox } from '@lobehub/ui';
import { Divider } from 'antd';
import { useTheme } from 'antd-style';
import { PlayIcon, Settings2Icon } from 'lucide-react';
import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import urlJoin from 'url-join';

import { EditorCanvas } from '@/features/EditorCanvas';
import { useQueryRoute } from '@/hooks/useQueryRoute';
import { useAgentGroupStore } from '@/store/agentGroup';
import { agentGroupSelectors } from '@/store/agentGroup/selectors';
import { useGroupProfileStore } from '@/store/groupProfile';

import AgentSettings from '../AgentSettings';
import AutoSaveHint from '../Header/AutoSaveHint';
import GroupPublishButton from '../Header/GroupPublishButton';
import GroupForkTag from './GroupForkTag';
import GroupHeader from './GroupHeader';
import GroupStatusTag from './GroupStatusTag';
import GroupVersionReviewTag from './GroupVersionReviewTag';

const GroupProfile = memo(() => {
  const { t } = useTranslation(['setting', 'chat']);
  const theme = useTheme();
  const [showAgentSetting, setShowAgentSetting] = useState(false);
  const groupId = useAgentGroupStore(agentGroupSelectors.activeGroupId);
  const currentGroup = useAgentGroupStore(agentGroupSelectors.currentGroup);
  const updateGroup = useAgentGroupStore((s) => s.updateGroup);
  const router = useQueryRoute();

  const editor = useGroupProfileStore((s) => s.editor);
  const handleContentChange = useGroupProfileStore((s) => s.handleContentChange);
  const agentBuilderContentUpdate = useGroupProfileStore((s) => s.agentBuilderContentUpdate);
  const setAgentBuilderContent = useGroupProfileStore((s) => s.setAgentBuilderContent);

  // Create save callback that captures latest groupId
  const saveContent = useCallback(
    async (payload: { content: string; editorData: Record<string, any> }) => {
      if (!groupId) return;
      await updateGroup(groupId, {
        content: payload.content,
        editorData: payload.editorData,
      });
    },
    [updateGroup, groupId],
  );

  const onContentChange = useCallback(() => {
    handleContentChange(saveContent);
  }, [handleContentChange, saveContent]);

  // Stabilize editorData object reference to prevent unnecessary re-renders
  const editorData = useMemo(
    () => ({
      content: currentGroup?.content ?? undefined,
      editorData: currentGroup?.editorData,
    }),
    [currentGroup?.content, currentGroup?.editorData],
  );

  // Watch for agent builder content updates and apply them directly to the editor
  useEffect(() => {
    if (!editor || !agentBuilderContentUpdate || !groupId) return;
    if (agentBuilderContentUpdate.entityId !== groupId) return;

    // Directly set the editor content
    editor.setDocument('markdown', agentBuilderContentUpdate.content);

    // Clear the update after processing to prevent re-applying
    setAgentBuilderContent('', '');
  }, [editor, agentBuilderContentUpdate, groupId, setAgentBuilderContent]);

  return (
    <>
      <Flexbox
        onClick={(e) => {
          e.stopPropagation();
        }}
        style={{ cursor: 'default', marginBottom: 12 }}
      >
        <Flexbox height={66} width={'100%'}>
          <Flexbox gap={8} horizontal paddingBlock={12}>
            <AutoSaveHint />
            <GroupStatusTag />
            <GroupVersionReviewTag />
            <GroupForkTag />
          </Flexbox>
        </Flexbox>
        {/* Header: Group Avatar + Title */}
        <GroupHeader />
        {/* Start Conversation Button */}
        <Flexbox
          align={'center'}
          gap={8}
          horizontal
          justify={'flex-start'}
          style={{ marginTop: 16 }}
        >
          <Button
            icon={PlayIcon}
            onClick={() => {
              if (!groupId) return;
              router.push(urlJoin('/group', groupId));
            }}
            type={'primary'}
          >
            {t('startConversation')}
          </Button>
          <GroupPublishButton />
          <Button
            icon={Settings2Icon}
            onClick={() => setShowAgentSetting(true)}
            size={'small'}
            style={{ color: theme.colorTextSecondary }}
            type={'text'}
          >
            {t('advancedSettings')}
          </Button>
        </Flexbox>
      </Flexbox>
      <Divider />
      {/* Group Content Editor */}
      <EditorCanvas
        editor={editor}
        editorData={editorData}
        entityId={groupId}
        onContentChange={onContentChange}
        placeholder={t('group.profile.contentPlaceholder', { ns: 'chat' })}
      />
      {/* Advanced Settings Modal */}
      <AgentSettings onCancel={() => setShowAgentSetting(false)} open={showAgentSetting} />
    </>
  );
});

export default GroupProfile;
