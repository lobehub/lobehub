'use client';

import { Button, type ItemType } from '@lobehub/ui';
import { PlusIcon } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import ActionDropdown from '@/features/ChatInput/ActionBar/components/ActionDropdown';
import ToolItem from '@/features/ChatInput/ActionBar/Tools/ToolItem';
import { useControls } from '@/features/ChatInput/ActionBar/Tools/useControls';
import { createStore, Provider } from '@/features/ChatInput/store';
import { createSkillStoreModal } from '@/features/SkillStore';

import type { AgentToolProps } from '../AgentTool';
import PluginTag from '../PluginTag';
import ProfilePopoverContent from '../PopoverContent';
import ToolListGroup, { type ToolGroupMeta } from '../ToolListGroup';

interface Props extends Pick<AgentToolProps, 'onOpenDetail' | 'showAuthor'> {
  agentId: string;
  group: ToolGroupMeta;
}

const LibraryTools = ({ group, onOpenDetail, showAuthor }: Omit<Props, 'agentId'>) => {
  const { t } = useTranslation('setting');
  const tools = useControls();
  const [open, setOpen] = useState(false);
  const items: ItemType[] = (['lobehub', 'community', 'custom'] as const).flatMap((source) => {
    const children = tools.toolOptions
      .filter((tool) => tool.group === source)
      .map((tool) => ({
        key: tool.id,
        icon: tool.icon,
        searchText: tool.searchText,
        popoverContent: tool.detail,
        label: tool.connectionAction ?? (
          <ToolItem
            checked={tool.enabled}
            disabled={!tools.canEdit || !tool.canDisable}
            id={tool.id}
            label={tool.title}
            onUpdate={(id, enabled) => tools.setPolicy(id, enabled ? 'auto' : 'disabled')}
          />
        ),
      }));
    return children.length
      ? [{ children, key: source, label: t(`skillStore.tabs.${source}`), type: 'group' as const }]
      : [];
  });
  return (
    <ToolListGroup
      {...group}
      activeCount={tools.autoCount}
      emptyText={t('settingAgent.tools.level.libraryEmpty')}
      total={tools.totalCount}
      addControl={
        <ActionDropdown
          maxWidth={400}
          menu={{ items: [], style: { maxHeight: 'unset', overflowY: 'visible' } }}
          minWidth={400}
          open={open}
          placement="bottomLeft"
          popupProps={{ style: { padding: 0 } }}
          trigger="click"
          popupRender={() => (
            <ProfilePopoverContent
              toolsOnly
              items={items}
              onClose={() => setOpen(false)}
              onOpenStore={() => {
                setOpen(false);
                createSkillStoreModal();
              }}
            />
          )}
          positionerProps={{
            collisionAvoidance: { align: 'flip', fallbackAxisSide: 'end', side: 'flip' },
            collisionBoundary:
              typeof document === 'undefined' ? undefined : document.documentElement,
            positionMethod: 'fixed',
          }}
          onOpenChange={setOpen}
        >
          <Button disabled={!tools.canEdit} icon={PlusIcon} size="small" type="text">
            {t('settingAgent.agentTools.add')}
          </Button>
        </ActionDropdown>
      }
      rows={tools.activeTools.map(({ id, canDisable }) => (
        <PluginTag
          enabled
          useAllMetaList
          disabled={!tools.canEdit || !canDisable}
          key={id}
          pluginId={id}
          removable={false}
          showAuthor={showAuthor}
          variant="row"
          onOpen={onOpenDetail}
          onToggle={(on) => void tools.setPolicy(id, on ? 'auto' : 'disabled')}
        />
      ))}
    />
  );
};

// The picker and its nested search/memory settings must read and write the
// profile being edited, even when another agent is open in the composer.
const ProfileToolPicker = ({ agentId, ...props }: Props) => (
  <Provider createStore={() => createStore({ agentId })} key={agentId}>
    <LibraryTools {...props} />
  </Provider>
);

export default ProfileToolPicker;
