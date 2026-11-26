'use client';

import ConversationSetting from '@/features/Settings/conversation';

/**
 * Personal conversation preferences mirrored under
 * `/:workspaceSlug/settings/conversation`. User-scoped and open to every role;
 * the workspace shell renders the compact header, so the page header is hidden.
 */
const WorkspaceConversationSetting = () => <ConversationSetting showSettingHeader={false} />;

WorkspaceConversationSetting.displayName = 'WorkspaceConversationSetting';

export default WorkspaceConversationSetting;
