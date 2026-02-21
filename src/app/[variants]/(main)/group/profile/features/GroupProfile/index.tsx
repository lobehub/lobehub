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
        style={{ cursor: 'default', marginBottom: 12 }}
        onClick={(e) => {
          e.stopPropagation();
        }}
      >
        <Flexbox height={66} width={'100%'}>
          <Flexbox horizontal gap={8} paddingBlock={12}>
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
          horizontal
          align={'center'}
          gap={8}
          justify={'flex-start'}
          style={{ marginTop: 16 }}
        >
          <Button
            icon={PlayIcon}
            type={'primary'}
            onClick={() => {
              if (!groupId) return;
              router.push(urlJoin('/group', groupId));
            }}
          >
            {t('startConversation')}
          </Button>
          <GroupPublishButton />
          <Button
            icon={Settings2Icon}
            size={'small'}
            style={{ color: theme.colorTextSecondary }}
            type={'text'}
            onClick={() => setShowAgentSetting(true)}
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
        placeholder={t('group.profile.contentPlaceholder', { ns: 'chat' })}
        onContentChange={onContentChange}
      />
      {/* Advanced Settings Modal */}
      <AgentSettings open={showAgentSetting} onCancel={() => setShowAgentSetting(false)} />
    </>
  );
});

export default GroupProfile;
