export default {
  'messenger.activeAgent': 'Active agent',
  'messenger.activeAgentHintEmpty':
    'No active agent. Pick one above or use /agents in the bot. Until then inbound messages will be parked.',
  'messenger.activeAgentPlaceholder': 'Select an agent',
  'messenger.detail.addWorkspace': 'Add workspace',
  'messenger.detail.connections.connected': 'Connected',
  'messenger.detail.connections.empty': 'Open the bot and send /start to link your account.',
  'messenger.detail.connections.linkHint':
    'Workspace installed. Open Slack and DM the bot to finish linking your personal account.',
  'messenger.detail.connections.pending': 'Pending',
  'messenger.detail.connections.title': 'Connections',
  'messenger.detail.connections.userLabel': 'user',
  'messenger.detail.connections.workspaceLabel': 'workspace',
  'messenger.detail.disconnect': 'Disconnect',
  'messenger.helpCommands':
    'In the bot: send /agents to list your agents and tap one to switch which agent receives messages.',
  'messenger.linkCta': 'Connect',
  'messenger.list.slack.description': 'Use @LobeHub in Slack to assign tasks',
  'messenger.list.telegram.description': 'Message your task, get results delivered instantly',
  'messenger.linkedAccount': 'Linked to {{platform}} account {{handle}}',
  'messenger.linkModal.continueIn': 'Continue setup in {{platform}}',
  'messenger.linkModal.instructions':
    'Open the bot, send /start, then tap "Link Account" to connect your LobeHub account.',
  'messenger.linkModal.notConfigured':
    'Bot username is not configured. Set LOBE_TELEGRAM_BOT_USERNAME (without "@") in your environment to enable the deep link.',
  'messenger.linkModal.openCta': 'Open in {{platform}}',
  'messenger.linkModal.scanHint': 'Or scan with your phone to open {{platform}}.',
  'messenger.linkModal.title': 'Connect Messenger',
  'messenger.noPlatformsConfigured':
    'No messenger platforms are configured. Set bot tokens (e.g. LOBE_TELEGRAM_BOT_TOKEN) in your environment to enable.',
  'messenger.slack.connectModal.continueButton': 'Continue in Slack',
  'messenger.slack.connectModal.description':
    'You will be redirected to Slack to authorize the LobeHub workspace install.',
  'messenger.slack.connectModal.notConfigured':
    'Slack OAuth is not configured. Set LOBE_SLACK_CLIENT_ID, LOBE_SLACK_CLIENT_SECRET, LOBE_SLACK_SIGNING_SECRET and LOBE_SLACK_APP_ID.',
  'messenger.slack.connectModal.title': 'Continue setup in Slack',
  'messenger.slack.connections.disconnect': 'Disconnect',
  'messenger.slack.connections.disconnectConfirm':
    'Disconnect the LobeHub bot from this Slack workspace? Existing user links will pause until you re-install.',
  'messenger.slack.connections.disconnectFailed': 'Failed to disconnect.',
  'messenger.slack.connections.disconnectSuccess': 'Workspace disconnected.',
  'messenger.slack.connections.disconnectTitle': 'Disconnect workspace',
  'messenger.slack.connections.installedAt': 'Installed {{date}}',
  'messenger.slack.connections.title': 'Connected workspaces',
  'messenger.slack.connections.workspace': 'Workspace: {{name}}',
  'messenger.setActiveFailed': 'Failed to set as active.',
  'messenger.setActiveSuccess': 'Active agent updated.',
  'messenger.statusLinked': 'Connected',
  'messenger.statusNotLinked': 'Not connected',
  'messenger.subtitle':
    'Connect your account to the official LobeHub bot once. Pick which agent receives messages, switch any time from here or from the bot.',
  'messenger.title': 'Messenger',
  'messenger.unlinkConfirm':
    'Disconnect your {{platform}} account from LobeHub? Inbound messages will stop until you /start again.',
  'messenger.unlinkCta': 'Disconnect',
  'messenger.unlinkFailed': 'Failed to disconnect.',
  'messenger.unlinkSuccess': 'Disconnected.',
  'messenger.unlinkTitle': 'Disconnect account',
  'verify.confirm.cta': 'Confirm linking',
  'verify.confirm.defaultAgent': 'Default agent',
  'verify.confirm.defaultAgentHint':
    'Your messages will be routed here first. You can switch any time via /agents in the bot or from Settings → Messenger.',
  'verify.confirm.defaultAgentPlaceholder': 'Select an agent',
  'verify.confirm.description':
    'Your LobeHub account "{{lobeAccount}}" will be linked with {{platform}} account "{{handle}}".',
  'verify.confirm.descriptionWithWorkspace':
    'Your LobeHub account "{{lobeAccount}}" will be linked with {{platform}} account "{{handle}}" in workspace "{{workspace}}".',
  'verify.confirm.noAgents':
    "You don't have any agents yet. Create one in LobeHub, then come back to finish linking.",
  'verify.confirm.title': 'Confirm linking',
  'verify.confirm.workspace': 'Workspace: {{workspace}}',
  'verify.error.expired': 'This link has expired. Please return to the bot and send /start again.',
  'verify.error.generic': 'Something went wrong. Please try again.',
  'verify.error.missingToken': 'Invalid link. Open this page from the bot.',
  'verify.error.title': 'Unable to confirm link',
  'verify.labRequired.description':
    'Messenger is currently a Labs feature. Enable it in Settings → Advanced → Labs and reload this page.',
  'verify.labRequired.openSettings': 'Open Labs settings',
  'verify.labRequired.title': 'Enable Messenger to continue',
  'verify.signInCta': 'Sign in to continue',
  'verify.signInRequired': 'Please sign in to LobeHub to confirm the link.',
  'verify.success.description':
    'Your account is now connected to {{platform}}. Open {{platform}} and send your first message.',
  'verify.success.openBot': 'Open in {{platform}}',
  'verify.success.title': 'Linked successfully!',
};
