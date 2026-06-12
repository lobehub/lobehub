import { COMPOSIO_APP_TYPES } from '@lobechat/const';
import { Avatar, Flexbox, Tag } from '@lobehub/ui';
import { confirmModal } from '@lobehub/ui/base-ui';
import { memo, useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useToolStore } from '@/store/tool';
import { type ComposioServer } from '@/store/tool/slices/composioStore';

interface ComposioAuthItemProps {
  server: ComposioServer;
}

const ComposioAuthItem = memo<ComposioAuthItemProps>(({ server }) => {
  const { t } = useTranslation('auth');
  const [isRevoking, setIsRevoking] = useState(false);

  const removeComposioConnection = useToolStore((s) => s.removeComposioConnection);

  // Get server type configuration (icons, etc.)
  const serverType = COMPOSIO_APP_TYPES.find((item) => item.identifier === server.identifier);

  // Handle deauthorization
  const handleRevoke = useCallback(() => {
    confirmModal({
      content: t('profile.authorizations.revoke.description'),
      okButtonProps: { danger: true },
      onOk: async () => {
        setIsRevoking(true);
        try {
          await removeComposioConnection(server.identifier);
        } finally {
          setIsRevoking(false);
        }
      },
      title: t('profile.authorizations.revoke.title', {
        name: serverType?.label || server.label,
      }),
    });
  }, [removeComposioConnection, server.identifier, server.label, serverType?.label, t]);

  // Render icon
  const renderIcon = () => {
    if (!serverType) return null;

    if (typeof serverType.icon === 'string') {
      return <Avatar avatar={serverType.icon} size={16} />;
    }

    const IconComponent = serverType.icon;
    return <IconComponent size={14} />;
  };

  return (
    <Tag closable onClose={handleRevoke}>
      <Flexbox horizontal align="center" gap={4} style={{ opacity: isRevoking ? 0.5 : 1 }}>
        {renderIcon()}
        {serverType?.label || server.label}
      </Flexbox>
    </Tag>
  );
});

interface ComposioAuthorizationListProps {
  servers: ComposioServer[];
}

export const ComposioAuthorizationList = memo<ComposioAuthorizationListProps>(({ servers }) => {
  return (
    <Flexbox horizontal gap={8} wrap="wrap">
      {servers.map((server) => (
        <ComposioAuthItem key={server.identifier} server={server} />
      ))}
    </Flexbox>
  );
});

export default ComposioAuthorizationList;
