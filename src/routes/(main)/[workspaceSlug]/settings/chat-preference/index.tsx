'use client';

import { ChatAssistForm } from '@/features/ServiceModel';

/**
 * Personal chat-assist preferences under `/:workspaceSlug/settings/chat-preference`.
 * User-scoped and open to every role; the workspace shell renders the compact
 * header.
 */
const WorkspaceChatPreferenceSetting = () => <ChatAssistForm />;

WorkspaceChatPreferenceSetting.displayName = 'WorkspaceChatPreferenceSetting';

export default WorkspaceChatPreferenceSetting;
