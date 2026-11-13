import { Flexbox, Text } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import ConnectorBrandIcon from '@/features/Connectors/ConnectorBrandIcon';
import { useConnectorDisplay } from '@/features/Connectors/useConnectorDisplay';
import {
  type McpEventAttributes,
  mcpEventSenderName,
} from '@/features/Conversation/Markdown/plugins/McpEvent/parseMcpEvent';
import WorkspaceLink from '@/features/Workspace/WorkspaceLink';

// Same frame and type sizes as the SCM sender, so a wake-up message from any
// integration sits the same way in the conversation.
const styles = stylex.create({
  caption: {
    fontSize: '12px',
    color: { 'default': cssVar.colorTextTertiary, ':hover': cssVar.colorTextSecondary },
  },
  mark: {
    display: 'flex',
    flex: 'none',
    alignItems: 'center',
    justifyContent: 'center',
    inlineSize: '36px',
    blockSize: '36px',
    borderRadius: '8px',
    color: cssVar.colorText,
    backgroundColor: cssVar.colorFillTertiary,
    backgroundImage: 'none',
  },
});

/** The connector's mark standing in for the avatar of an MCP event message. */
export const McpEventAvatar = memo<{ source: McpEventAttributes }>(({ source }) => {
  const connector = useConnectorDisplay(source.connector, source.connectorName);

  return (
    <span {...stylex.props(styles.mark)}>
      <ConnectorBrandIcon
        avatar={connector.avatar}
        identifier={connector.identifier}
        name={connector.name}
        size={20}
        sourceType={connector.sourceType}
      />
    </span>
  );
});

McpEventAvatar.displayName = 'McpEventAvatar';

/**
 * The connector as the sender name of an MCP event message, with a second
 * line saying it came from an event subscription — a link to where the user
 * can see and stop it. The message arrives without the user doing anything,
 * so where it came from and how to turn it off sit right on it.
 */
export const McpEventSenderTitle = memo<{ source: McpEventAttributes }>(({ source }) => {
  const { t } = useTranslation('integration');

  return (
    <Flexbox align={'flex-end'} gap={2} style={{ minWidth: 0 }}>
      <Text style={{ whiteSpace: 'nowrap' }} weight={500}>
        {mcpEventSenderName(source)}
      </Text>
      <WorkspaceLink to={'/settings/automations'} {...stylex.props(styles.caption)}>
        {t('mcpEvent.senderCaption')}
      </WorkspaceLink>
    </Flexbox>
  );
});

McpEventSenderTitle.displayName = 'McpEventSenderTitle';
