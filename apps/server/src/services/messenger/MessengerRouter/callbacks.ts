import type { Chat } from 'chat';
import debug from 'debug';

import { getServerDB } from '@/database/core/db-adaptor';
import { MessengerAccountLinkModel } from '@/database/models/messengerAccountLink';

import type { InstallationCredentials } from '../installations/types';
import { getMessengerSystemStrings } from '../systemReply';
import type {
  CallbackAcknowledgement,
  InboundCallbackAction,
  MessengerPlatformBinder,
} from '../types';
import { applyScopeSwitch, fetchUserScopes, toPickerEntries, toScopeEntries } from './agents';
import { modePickerEntries } from './mode';
import type { MessengerRouterDeps } from './types';
import { PERSONAL_SCOPE_ID } from './utils';

const log = debug('lobe-server:messenger:router');

/**
 * Run a tap-action surfaced by either the binder's webhook-time peek
 * (Slack/Telegram) or chat-sdk's `onAction` event (Discord). Both paths
 * normalize to the same `InboundCallbackAction` shape and delegate the
 * outbound ack (toast + picker re-render) to `binder.acknowledgeCallback`.
 * Recognizes `messenger:switch:<agentId>` (agent picker),
 * `messenger:scope:<scopeId>` (scope picker) and
 * `messenger:mode:<agent|chat>` (conversation-mode picker); new actions can
 * be added by extending the dispatch below.
 */
export async function handleCallbackAction(
  deps: MessengerRouterDeps,
  binder: MessengerPlatformBinder,
  creds: InstallationCredentials,
  action: InboundCallbackAction,
  chatBot?: Chat<any>,
): Promise<void> {
  if (!binder.acknowledgeCallback) return;

  const ack = binder.acknowledgeCallback.bind(binder, action);
  const strings = getMessengerSystemStrings(creds.platform);

  const scopeMatch = action.data.match(/^messenger:scope:(.+)$/);
  if (scopeMatch) {
    await handleScopeCallback(deps, creds, action, scopeMatch[1], ack);
    return;
  }

  const modeMatch = action.data.match(/^messenger:mode:(agent|chat)$/);
  if (modeMatch) {
    await handleModeCallback(creds, action, modeMatch[1] as 'agent' | 'chat', ack, chatBot);
    return;
  }

  const switchMatch = action.data.match(/^messenger:switch:(.+)$/);
  if (!switchMatch) {
    await ack({ toast: strings.unknownAction });
    return;
  }

  const targetAgentId = switchMatch[1];
  const serverDB = await getServerDB();
  const link = await MessengerAccountLinkModel.findByPlatformUser(
    serverDB,
    creds.platform,
    action.fromUserId,
    creds.tenantId,
  );
  if (!link) {
    await ack({ toast: strings.notLinked });
    return;
  }

  const userAgents = await deps.fetchUserAgents(serverDB, link.userId, link.workspaceId);
  const target = userAgents.find((agent) => agent.id === targetAgentId);
  if (!target) {
    await ack({ toast: strings.agentNotFound });
    return;
  }

  if (link.activeAgentId === targetAgentId) {
    await ack({ toast: strings.activeAgentAlreadyToast(target.title) });
    return;
  }

  await MessengerAccountLinkModel.setActiveAgentById(serverDB, link.id, targetAgentId);
  await ack({
    toast: strings.activeAgentChangedToast(target.title),
    updatedPicker: {
      entries: toPickerEntries(userAgents, targetAgentId, strings),
      text: strings.receiveMessagesPicker,
    },
  });
}

/**
 * Handle a tap on a `/mode` button (`messenger:mode:<agent|chat>`). The
 * mode lives in chat-sdk thread state, so the write targets the user's
 * canonical DM conversation via `openDM` — the same thread the slash-path
 * `/mode` writes and the runtime reads (openDM is idempotent; see
 * `handleSlashCommand`). Re-renders the picker with the new active mark.
 */
export async function handleModeCallback(
  creds: InstallationCredentials,
  action: InboundCallbackAction,
  mode: 'agent' | 'chat',
  ack: (ack: CallbackAcknowledgement) => Promise<void>,
  chatBot?: Chat<any>,
): Promise<void> {
  const strings = getMessengerSystemStrings(creds.platform);
  const serverDB = await getServerDB();
  const link = await MessengerAccountLinkModel.findByPlatformUser(
    serverDB,
    creds.platform,
    action.fromUserId,
    creds.tenantId,
  );
  if (!link) {
    await ack({ toast: strings.notLinked });
    return;
  }

  let thread: any | undefined;
  try {
    thread = await chatBot?.openDM(action.fromUserId);
  } catch (error) {
    log('handleModeCallback: openDM(%s) failed: %O', action.fromUserId, error);
  }
  if (!thread) {
    await ack({ toast: strings.genericError });
    return;
  }

  try {
    await thread.setState({ toolMode: mode });
  } catch (error) {
    log('handleModeCallback: setState failed: %O', error);
    await ack({ toast: strings.genericError });
    return;
  }

  const label = mode === 'agent' ? strings.modeAgentLabel : strings.modeChatLabel;
  await ack({
    toast: strings.modeChangedToast(label),
    updatedPicker: {
      action: 'mode',
      entries: modePickerEntries(mode, strings),
      text: strings.modePicker,
    },
  });
}

/**
 * Handle a tap on a `/switch` scope button (`messenger:scope:<scopeId>`).
 * `scopeToken` is the workspace id, or `PERSONAL_SCOPE_ID` for Personal.
 * Switches the active scope (landing on the scope's default agent) and
 * re-renders the picker with the new current marker.
 */
export async function handleScopeCallback(
  deps: MessengerRouterDeps,
  creds: InstallationCredentials,
  action: InboundCallbackAction,
  scopeToken: string,
  ack: (ack: CallbackAcknowledgement) => Promise<void>,
): Promise<void> {
  const strings = getMessengerSystemStrings(creds.platform);
  const serverDB = await getServerDB();
  const link = await MessengerAccountLinkModel.findByPlatformUser(
    serverDB,
    creds.platform,
    action.fromUserId,
    creds.tenantId,
  );
  if (!link) {
    await ack({ toast: strings.notLinked });
    return;
  }

  const targetScopeId = scopeToken === PERSONAL_SCOPE_ID ? null : scopeToken;
  const scopes = await fetchUserScopes(serverDB, link.userId, creds.platform);
  const target = scopes.find((scope) => scope.id === targetScopeId);
  if (!target) {
    await ack({ toast: strings.scopeNotFound });
    return;
  }

  if ((link.workspaceId ?? null) === target.id) {
    await ack({ toast: strings.scopeAlready(target.name) });
    return;
  }

  const defaultAgent = await applyScopeSwitch(deps, serverDB, link.id, link.userId, target);
  await ack({
    toast: strings.scopeSwitched(target.name, defaultAgent?.title),
    updatedPicker: {
      action: 'scope',
      entries: toScopeEntries(scopes, target.id),
      text: strings.scopePicker,
    },
  });
}
