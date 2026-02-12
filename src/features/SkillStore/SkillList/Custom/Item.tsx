'use client';

import { ActionIcon, Block, DropdownMenu, Flexbox, Icon } from '@lobehub/ui';
import { App } from 'antd';
import { createStaticStyles, cssVar } from 'antd-style';
import { MoreVerticalIcon, PackageSearch, Trash2 } from 'lucide-react';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import PluginAvatar from '@/components/Plugins/PluginAvatar';
import PluginDetailModal from '@/features/PluginDetailModal';
import DevModal from '@/features/PluginDevModal';
import { useAgentStore } from '@/store/agent';
import { agentSelectors } from '@/store/agent/selectors';
import { useToolStore } from '@/store/tool';
import { pluginSelectors } from '@/store/tool/selectors';

import { itemStyles } from '../style';

const styles = createStaticStyles(({ css }) => ({
  title: css`
    cursor: pointer;

    overflow: hidden;

    font-size: 14px;
    font-weight: 500;
    color: ${cssVar.colorText};
    text-overflow: ellipsis;
    white-space: nowrap;

    &:hover {
      color: ${cssVar.colorPrimary};
    }
  `,
}));

interface ItemProps {
  avatar?: string;
  description?: string;
  identifier: string;
  title?: string;
}

const Item = memo<ItemProps>(({ identifier, title, description, avatar }) => {
  const { t } = useTranslation('plugin');
  const { modal } = App.useApp();
  const [configOpen, setConfigOpen] = useState(false);
  const [detailOpen, setDetailOpen] = useState(false);

  const [customPlugin, uninstallPlugin, updateCustomPlugin, pluginManifest] = useToolStore((s) => [
    pluginSelectors.getCustomPluginById(identifier)(s),
    s.uninstallPlugin,
    s.updateCustomPlugin,
    pluginSelectors.getToolManifestById(identifier)(s),
  ]);

  const [togglePlugin, isPluginEnabledInAgent] = useAgentStore((s) => [
    s.togglePlugin,
    agentSelectors.currentAgentPlugins(s).includes(identifier),
  ]);

  const handleDelete = () => {
    modal.confirm({
      centered: true,
      okButtonProps: { danger: true },
      onOk: async () => {
        if (isPluginEnabledInAgent) {
          await togglePlugin(identifier, false);
        }
        await uninstallPlugin(identifier);
      },
      title: t('store.actions.confirmUninstall'),
      type: 'error',
    });
  };

  return (
    <>
      <Flexbox className={itemStyles.container} gap={0}>
        <Block
          horizontal
          align={'center'}
          gap={12}
          paddingBlock={12}
          paddingInline={12}
          variant={'outlined'}
        >
          <PluginAvatar avatar={avatar} size={40} />
          <Flexbox flex={1} gap={4} style={{ minWidth: 0, overflow: 'hidden' }}>
            <span className={styles.title} onClick={() => setDetailOpen(true)}>
              {title || identifier}
            </span>
            {description && <span className={itemStyles.description}>{description}</span>}
          </Flexbox>
          <Flexbox horizontal>
            <ActionIcon
              icon={PackageSearch}
              title={t('store.actions.manifest')}
              onClick={() => setConfigOpen(true)}
            />
            <DropdownMenu
              nativeButton={false}
              placement="bottomRight"
              items={[
                {
                  danger: true,
                  icon: <Icon icon={Trash2} />,
                  key: 'uninstall',
                  label: t('store.actions.uninstall'),
                  onClick: handleDelete,
                },
              ]}
            >
              <ActionIcon icon={MoreVerticalIcon} />
            </DropdownMenu>
          </Flexbox>
        </Block>
      </Flexbox>
      {customPlugin && (
        <DevModal
          mode="edit"
          open={configOpen}
          value={customPlugin}
          onOpenChange={setConfigOpen}
          onDelete={async () => {
            if (isPluginEnabledInAgent) {
              await togglePlugin(identifier, false);
            }
            await uninstallPlugin(identifier);
          }}
          onSave={async (value) => {
            await updateCustomPlugin(identifier, value);
          }}
        />
      )}
      <PluginDetailModal
        id={identifier}
        open={detailOpen}
        schema={pluginManifest?.settings}
        tab="info"
        onClose={() => setDetailOpen(false)}
      />
    </>
  );
});

Item.displayName = 'CustomListItem';

export default Item;
