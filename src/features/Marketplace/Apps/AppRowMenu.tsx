import { confirmModal, Icon } from '@lobehub/ui';
import { Unplug } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { RowMoreMenu } from '@/features/Settings/skill/features/RowActions';
import { useLobehubSkillScope } from '@/features/Settings/skill/features/useLobehubSkillScope';
import { useSkillConnect } from '@/features/SkillStore/SkillList/LobeHub/useSkillConnect';
import { usePermission } from '@/hooks/usePermission';
import { useToolStore } from '@/store/tool';
import { lobehubSkillStoreSelectors } from '@/store/tool/slices/lobehubSkillStore/selectors';

import type { MarketplaceApp } from './catalog';

/** Disconnect for an app connected as a LobeHub or Composio tool, behind a confirmation. */
const ToolMenu = memo<{
  app: MarketplaceApp & { tool: NonNullable<MarketplaceApp['tool']> };
  label: string;
  onOpenDetail: () => void;
}>(({ app, label, onOpenDetail }) => {
  const { t } = useTranslation('setting');
  const { allowed: canEditContent } = usePermission('edit_own_content');
  // Only workspace admins change a workspace's LobeHub Skill connection.
  const lobehubServer = useToolStore(lobehubSkillStoreSelectors.getServerByIdentifier(app.id));
  const scope = useLobehubSkillScope(
    app.tool.type === 'lobehub' ? lobehubServer : undefined,
    app.name,
  );
  const canEdit = canEditContent && (app.tool.type !== 'lobehub' || scope.canManage);
  const { handleDisconnect } = useSkillConnect({
    identifier: app.id,
    serverName: app.name,
    type: app.tool.type,
  });

  return (
    <RowMoreMenu
      label={label}
      items={[
        {
          danger: true,
          disabled: !canEdit,
          icon: <Icon icon={Unplug} />,
          key: 'disconnect',
          label: t('tools.lobehubSkill.disconnect'),
          onClick: () =>
            confirmModal({
              cancelText: t('cancel', { ns: 'common' }),
              content: [
                scope.disconnectNote,
                t('tools.lobehubSkill.disconnectConfirm.desc', { name: app.name }),
              ]
                .filter(Boolean)
                .join(' '),
              okButtonProps: { danger: true },
              okText: t('tools.lobehubSkill.disconnect'),
              onOk: () => handleDisconnect(),
              title: t('tools.lobehubSkill.disconnectConfirm.title', { name: app.name }),
            }),
        },
      ]}
      onOpenDetail={onOpenDetail}
    />
  );
});

ToolMenu.displayName = 'MarketplaceAppToolMenu';

/**
 * A connected row's `…`: Details, and Disconnect when the app is connected as a
 * tool. A chat channel or an integration (GitHub App, Linear workspace) is
 * managed on its page, so its menu only opens that.
 */
const AppRowMenu = memo<{ app: MarketplaceApp; label: string; onOpenDetail: () => void }>(
  ({ app, label, onOpenDetail }) => {
    const { tool } = app;
    if (tool && app.toolConnected)
      return <ToolMenu app={{ ...app, tool }} label={label} onOpenDetail={onOpenDetail} />;
    return <RowMoreMenu label={label} onOpenDetail={onOpenDetail} />;
  },
);

AppRowMenu.displayName = 'MarketplaceAppRowMenu';

export default AppRowMenu;
