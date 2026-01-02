import { KLAVIS_SERVER_TYPES } from '@lobechat/const';
import { Avatar, Flexbox, Tag } from '@lobehub/ui';
import { memo, useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { modal } from '@/components/AntdStaticMethods';
import { useServerConfigStore } from '@/store/serverConfig';
import { serverConfigSelectors } from '@/store/serverConfig/selectors';
import { useToolStore } from '@/store/tool';
import { type KlavisServer, KlavisServerStatus } from '@/store/tool/slices/klavisStore';
import { type ToolStore } from '@/store/tool/store';

interface KlavisAuthItemProps {
  server: KlavisServer;
}

const KlavisAuthItem = memo<KlavisAuthItemProps>(({ server }) => {
  const { t } = useTranslation('auth');
  const [isRevoking, setIsRevoking] = useState(false);

  const removeKlavisServer = useToolStore((s) => s.removeKlavisServer);

  // 获取服务器类型配置（图标等）
  const serverType = KLAVIS_SERVER_TYPES.find((item) => item.identifier === server.identifier);

  // 处理取消授权
  const handleRevoke = useCallback(() => {
    modal.confirm({
      content: t('profile.authorizations.revoke.description'),
      okButtonProps: { danger: true },
      onOk: async () => {
        setIsRevoking(true);
        try {
          await removeKlavisServer(server.identifier);
        } finally {
          setIsRevoking(false);
        }
      },
      title: t('profile.authorizations.revoke.title', {
        name: serverType?.label || server.serverName,
      }),
    });
  }, [removeKlavisServer, server.identifier, server.serverName, serverType?.label, t]);

  // 渲染图标
  const renderIcon = () => {
    if (!serverType) return null;

    if (typeof serverType.icon === 'string') {
      return <Avatar avatar={serverType.icon} size={16} />;
    }

    const IconComponent = serverType.icon;
    return <IconComponent size={14} />;
  };

  // 只显示已连接的服务器
  if (server.status !== KlavisServerStatus.CONNECTED) {
    return null;
  }

  return (
    <Tag closable onClose={handleRevoke}>
      <Flexbox align="center" gap={4} horizontal style={{ opacity: isRevoking ? 0.5 : 1 }}>
        {renderIcon()}
        {serverType?.label || server.serverName}
      </Flexbox>
    </Tag>
  );
});

export const KlavisAuthorizationList = memo(() => {
  const enableKlavis = useServerConfigStore(serverConfigSelectors.enableKlavis);
  const useFetchUserKlavisServers = useToolStore((s: ToolStore) => s.useFetchUserKlavisServers);
  const servers = useToolStore((s: ToolStore) => s.servers);

  // 获取已授权的服务器列表
  useFetchUserKlavisServers(enableKlavis);

  // 只显示已连接的服务器
  const connectedServers = servers.filter((s) => s.status === KlavisServerStatus.CONNECTED);

  if (!enableKlavis || connectedServers.length === 0) {
    return null;
  }

  return (
    <Flexbox gap={8} horizontal wrap="wrap">
      {connectedServers.map((server) => (
        <KlavisAuthItem key={server.identifier} server={server} />
      ))}
    </Flexbox>
  );
});

export default KlavisAuthorizationList;
