export default {
  'messenger.activeAgent': 'Active agent',
  'messenger.activeAgentPlaceholder': 'Select an agent',
  'messenger.detail.addServer': 'Add server',
  'messenger.detail.addWorkspace': 'Add workspace',
  'messenger.detail.connections.connected': 'Connected',
  'messenger.detail.connections.empty': 'Open the bot and send /start to link your account.',
  'messenger.detail.connections.linkHint':
    'Workspace installed. Open Slack and DM the bot to finish linking your personal account.',
  'messenger.detail.connections.pending': 'Pending',
  'messenger.detail.connections.serverLabel': 'server',
  'messenger.detail.connections.title': 'Connections',
  'messenger.detail.connections.userLabel': 'user',
  'messenger.detail.connections.workspaceLabel': 'workspace',
  'messenger.detail.disconnect': 'Disconnect',
  'messenger.error.agentNotFound': 'Agent not found.',
  'messenger.error.disconnectNotAllowed': 'You can only disconnect installations you started.',
  'messenger.error.installationNotFound': 'Installation not found.',
  'messenger.error.linkRequired': 'Open the bot and send /start before changing this connection.',
  'messenger.error.pickDefaultAgent': 'Select a default agent before confirming.',
  'messenger.error.platformNotConfigured':
    "This messenger platform isn't available right now. Please try again later.",
  'messenger.linkCta': 'Connect',
  'messenger.linkModal.continueIn': 'Continue setup in {{platform}}',
  'messenger.linkModal.instructions':
    'Open the bot, send /start, then tap "Link Account" to connect your LobeHub account.',
  'messenger.linkModal.notConfigured':
    "This connection isn't available right now. Please try again later.",
  'messenger.linkModal.openCta': 'Open in {{platform}}',
  'messenger.linkModal.scanHint': 'Or scan with your phone to open {{platform}}.',
  'messenger.linkModal.title': 'Connect Messenger',
  'messenger.noPlatformsConfigured': 'No platforms are available yet. Check back soon.',
  'messenger.slack.connectModal.continueButton': 'Continue in Slack',
  'messenger.slack.connectModal.description':
    'You will be redirected to Slack to authorize the LobeHub workspace install.',
  'messenger.slack.connectModal.notConfigured':
    "Slack isn't available right now. Please try again later.",
  'messenger.slack.connectModal.title': 'Continue setup in Slack',
  'messenger.slack.connections.disconnectConfirm':
    'Disconnect the LobeHub bot from this Slack workspace? Existing user links will pause until you re-install.',
  'messenger.slack.connections.disconnectFailed': 'Failed to disconnect.',
  'messenger.slack.connections.disconnectSuccess': 'Workspace disconnected.',
  'messenger.slack.connections.disconnectTitle': 'Disconnect workspace',
  'messenger.slack.installBlocked.dismiss': 'Got it',
  'messenger.slack.installBlocked.suggestion':
    "DM @LobeHub in Slack to link your personal account — you don't need to install again. Or ask the original installer to disconnect this workspace first if you want to take over ownership.",
  'messenger.slack.installBlocked.title': 'Workspace already connected',
  'messenger.slack.installBlocked.withName':
    '"{{workspace}}" is already connected to LobeHub by another user.',
  'messenger.slack.installBlocked.withoutName':
    'This Slack workspace is already connected to LobeHub by another user.',
  'messenger.slack.installResult.failed':
    'Slack install failed ({{reason}}). Please try again or contact support.',
  'messenger.slack.installResult.reasons.accessDenied': 'authorization was cancelled',
  'messenger.slack.installResult.reasons.exchangeFailed': 'Slack authorization failed',
  'messenger.slack.installResult.reasons.generic': 'an unknown error occurred',
  'messenger.slack.installResult.reasons.invalidState': 'the install session expired',
  'messenger.slack.installResult.reasons.missingAppId': 'Slack returned incomplete app information',
  'messenger.slack.installResult.reasons.missingCodeOrState':
    'Slack returned incomplete install parameters',
  'messenger.slack.installResult.reasons.missingTenant':
    'Slack did not return a workspace identifier',
  'messenger.slack.installResult.reasons.missingToken': 'Slack did not return a bot token',
  'messenger.slack.installResult.reasons.persistFailed':
    'the workspace connection could not be saved',
  'messenger.slack.installResult.success': 'Slack workspace connected.',
  'messenger.discord.connectModal.description':
    'Add the LobeHub bot to a Discord server you manage.',
  'messenger.discord.connectModal.inviteButton': 'Add to Discord server',
  'messenger.discord.connectModal.notConfigured':
    "Discord isn't available right now. Please try again later.",
  'messenger.discord.connectModal.title': 'Add bot to your server',
  'messenger.discord.connections.disconnectConfirm':
    'Remove this server from your audit list? The bot will stay in the server until a server admin kicks it.',
  'messenger.discord.connections.disconnectFailed': 'Failed to remove server.',
  'messenger.discord.connections.disconnectSuccess': 'Server removed.',
  'messenger.discord.connections.disconnectTitle': 'Remove server',
  'messenger.discord.userPending.cta': 'Open in Discord',
  'messenger.discord.userPending.hint':
    'Open the bot in Discord and send any message to finish linking your account.',
  'messenger.discord.userPending.name': 'Not linked yet',
  'messenger.list.discord.description':
    'Chat with your LobeHub agents from any Discord server via DM with the LobeHub bot.',
  'messenger.list.slack.description':
    'Chat with your LobeHub agents from any Slack workspace via DM or @LobeHub.',
  'messenger.list.telegram.description':
    'Chat with your LobeHub agents in Telegram and pick which one answers from anywhere.',
  'messenger.setActiveFailed': 'Failed to set as active.',
  'messenger.setActiveSuccess': 'Active agent updated.',
  'messenger.subtitle':
    'Connect your account to the official LobeHub bot once. Pick which agent receives messages, switch any time from here or from the bot.',
  'messenger.title': 'Messenger',
  'messenger.unlinkConfirm':
    'Disconnect your {{platform}} account from LobeHub? Inbound messages will stop until you /start again.',
  'messenger.unlinkCta': 'Disconnect',
  'messenger.unlinkFailed': 'Failed to disconnect.',
  'messenger.unlinkSuccess': 'Disconnected.',
  'messenger.unlinkTitle': 'Disconnect account',
  'verify.confirm.conflict.description':
    'This {{platform}} account is already linked to LobeHub account {{email}}. Sign in to that account to manage the link, or unlink there before retrying.',
  'verify.confirm.conflict.switchAccount': 'Sign in with another account',
  'verify.confirm.conflict.title': 'This account is already linked',
  'verify.confirm.cta': 'Confirm linking',
  'verify.confirm.defaultAgent': 'Default agent',
  'verify.confirm.defaultAgentHint':
    'Your messages will be routed here first. You can switch any time via /agents in the bot or from Settings → Messenger.',
  'verify.confirm.defaultAgentPlaceholder': 'Select an agent',
  'verify.confirm.fields.lobeHubAccount': 'LobeHub account',
  'verify.confirm.fields.platformAccount': '{{platform}} account',
  'verify.confirm.fields.workspace': 'Workspace',
  'verify.confirm.noAgents':
    "You don't have any agents yet. Create one in LobeHub, then come back to finish linking.",
  'verify.confirm.title': 'Confirm linking',
  'verify.confirm.workspace': 'Workspace: {{workspace}}',
  'verify.error.alreadyLinkedToOther':
    'This account is already linked to a different LobeHub account. Sign in to that account first.',
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
