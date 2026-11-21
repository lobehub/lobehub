import { getComposioAppByIdentifier, getLobehubSkillProviderById } from '@lobechat/const';
import { Avatar, Icon } from '@lobehub/ui';
import { McpIcon } from '@lobehub/ui/icons';
import { memo } from 'react';

import { ConnectorSourceType } from '@/database/schemas';
import { useToolStore } from '@/store/tool';

/** The placeholder avatar the MCP install flow stores when a server has none. */
const MCP_PLACEHOLDER_AVATAR = 'MCP_AVATAR';

interface ConnectorBrandIconProps {
  /** An avatar the caller already has (a list row's `connector.avatar`). Wins when set. */
  avatar?: string | null;
  identifier: string;
  name?: string;
  size: number;
  /** Built-in connectors take their mark from the builtin tool list. */
  sourceType?: string;
}

/**
 * A connector's brand mark, bare: the stored avatar, the Composio / LobeHub
 * provider logo, the builtin tool's avatar, else the generic MCP mark. One
 * resolution for every surface that names a connector — the detail page,
 * the automation list, an event message's sender — so the same connector
 * looks the same everywhere. Callers frame it.
 */
const ConnectorBrandIcon = memo<ConnectorBrandIconProps>(
  ({ avatar, identifier, name, size, sourceType }) => {
    const builtinAvatar = useToolStore((s) =>
      sourceType === ConnectorSourceType.builtin
        ? s.builtinTools?.find((tool) => tool.identifier === identifier)?.avatar
        : undefined,
    );

    if (avatar && avatar !== MCP_PLACEHOLDER_AVATAR)
      return <Avatar alt={name} avatar={avatar} shape={'square'} size={size} />;
    if (builtinAvatar) return <Avatar avatar={builtinAvatar} size={size} />;

    const brand = getComposioAppByIdentifier(identifier) ?? getLobehubSkillProviderById(identifier);
    if (brand) {
      if (typeof brand.icon === 'string')
        return <Avatar alt={brand.label} avatar={brand.icon} size={size} />;
      return <Icon fill={'currentColor'} icon={brand.icon} size={size} />;
    }

    return <Icon icon={McpIcon} size={size} />;
  },
);

ConnectorBrandIcon.displayName = 'ConnectorBrandIcon';

export default ConnectorBrandIcon;
