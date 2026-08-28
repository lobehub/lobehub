import type { Chat } from 'chat';

const FORWARDED_INTERACTION_EVENT = 'GATEWAY_INTERACTION_CREATE';
const APPLICATION_COMMAND_INTERACTION = 2;
const MESSAGE_COMPONENT_INTERACTION = 3;
const DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE = 5;
const DEFERRED_UPDATE_MESSAGE = 6;
const PATCHED_FLAG = Symbol.for('lobe.discord.forwarded-interactions.patched');

interface ForwardedGatewayEvent {
  data?: Record<string, unknown>;
  type?: string;
}

interface ForwardedInteraction {
  id: string;
  token: string;
  type: number;
}

/**
 * `WebhookOptions` as far as this patch cares: the only field we touch is
 * `waitUntil`, which the Chat SDK uses to hand background work back to the
 * host runtime.
 */
interface DispatchOptions {
  waitUntil?: (task: Promise<unknown>) => void;
}

interface ForwardedInteractionAdapter {
  discordInteractionFetch: (
    path: string,
    method: string,
    body: Record<string, unknown>,
  ) => Promise<Response>;
  /**
   * Present since `@chat-adapter/discord@4.32.0`, where the slash-command
   * handler stopped taking the raw interaction. Its absence is what selects
   * the legacy call shape below.
   */
  getApplicationCommandContext?: (interaction: ForwardedInteraction) => unknown;
  getInteractionFlags?: (context: unknown) => number | undefined;
  handleApplicationCommandInteraction: (
    contextOrInteraction: unknown,
    initialResponseFlagsOrOptions?: unknown,
    options?: unknown,
  ) => void;
  handleComponentInteraction: (interaction: ForwardedInteraction, options?: unknown) => void;
  handleForwardedGatewayEvent: (
    event: ForwardedGatewayEvent,
    options?: unknown,
  ) => Promise<Response>;
  [PATCHED_FLAG]?: boolean;
}

const okResponse = () =>
  new Response(JSON.stringify({ ok: true }), {
    headers: { 'Content-Type': 'application/json' },
    status: 200,
  });

const isForwardedInteractionAdapter = (
  adapter: unknown,
): adapter is ForwardedInteractionAdapter => {
  if (!adapter || typeof adapter !== 'object') return false;

  return (
    typeof (adapter as ForwardedInteractionAdapter).discordInteractionFetch === 'function' &&
    typeof (adapter as ForwardedInteractionAdapter).handleApplicationCommandInteraction ===
      'function' &&
    typeof (adapter as ForwardedInteractionAdapter).handleComponentInteraction === 'function' &&
    typeof (adapter as ForwardedInteractionAdapter).handleForwardedGatewayEvent === 'function'
  );
};

const getDeferredResponseType = (interactionType: number) => {
  switch (interactionType) {
    case APPLICATION_COMMAND_INTERACTION: {
      return DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE;
    }
    case MESSAGE_COMPONENT_INTERACTION: {
      return DEFERRED_UPDATE_MESSAGE;
    }
    default: {
      return null;
    }
  }
};

export const patchDiscordForwardedInteractions = (chatBot: Chat<any>) => {
  const adapter = (chatBot as any).adapters?.get?.('discord');

  if (!isForwardedInteractionAdapter(adapter) || adapter[PATCHED_FLAG]) return;

  const originalHandleForwardedGatewayEvent = adapter.handleForwardedGatewayEvent.bind(adapter);

  adapter.handleForwardedGatewayEvent = async (event, options) => {
    if (event?.type !== FORWARDED_INTERACTION_EVENT) {
      return originalHandleForwardedGatewayEvent(event, options);
    }

    const interaction = event.data as Partial<ForwardedInteraction> | undefined;

    if (!interaction?.id || !interaction.token || typeof interaction.type !== 'number') {
      return originalHandleForwardedGatewayEvent(event, options);
    }

    const responseType = getDeferredResponseType(interaction.type);

    if (!responseType) {
      return originalHandleForwardedGatewayEvent(event, options);
    }

    const isApplicationCommand = interaction.type === APPLICATION_COMMAND_INTERACTION;

    // Slash commands: mirror the adapter's own HTTP interaction path, which
    // derives a context object before dispatching and folds the resolved
    // ephemeral flags into the deferred response.
    //
    // `getApplicationCommandContext` only exists on `@chat-adapter/discord`
    // >= 4.32.0, where `handleApplicationCommandInteraction` switched from
    // `(interaction, options)` to `(context, initialResponseFlags, options)`.
    // Probing for the method — rather than the package version — keeps this
    // patch working against both call shapes.
    const usesCommandContext =
      isApplicationCommand && typeof adapter.getApplicationCommandContext === 'function';
    const commandContext = usesCommandContext
      ? adapter.getApplicationCommandContext!(interaction as ForwardedInteraction)
      : undefined;
    const initialResponseFlags =
      usesCommandContext && typeof adapter.getInteractionFlags === 'function'
        ? adapter.getInteractionFlags(commandContext)
        : undefined;

    // The Chat SDK hands slash-command work back through `options.waitUntil`.
    // Collect those tasks and await them before responding: this handler runs
    // in a serverless function that may be frozen the moment it returns, and
    // the deferred interaction stays a spinner until a handler PATCHes
    // `/messages/@original`. Any host-provided `waitUntil` still gets the task
    // too, so platforms that keep work alive on their own are unaffected.
    const pendingTasks: Promise<unknown>[] = [];
    const hostWaitUntil = (options as DispatchOptions | undefined)?.waitUntil;
    const dispatchOptions: DispatchOptions = {
      ...(options as DispatchOptions | undefined),
      waitUntil: (task) => {
        pendingTasks.push(task);
        hostWaitUntil?.(task);
      },
    };

    // Gateway-forwarded interactions bypass Discord's HTTP webhook response path,
    // so we must send the deferred callback manually before dispatching handlers.
    await adapter.discordInteractionFetch(
      `/interactions/${interaction.id}/${interaction.token}/callback`,
      'POST',
      {
        ...(initialResponseFlags === undefined ? {} : { data: { flags: initialResponseFlags } }),
        type: responseType,
      },
    );

    if (isApplicationCommand) {
      if (usesCommandContext) {
        adapter.handleApplicationCommandInteraction(
          commandContext,
          initialResponseFlags,
          dispatchOptions,
        );
      } else {
        adapter.handleApplicationCommandInteraction(
          interaction as ForwardedInteraction,
          dispatchOptions,
        );
      }
    } else {
      adapter.handleComponentInteraction(interaction as ForwardedInteraction, dispatchOptions);
    }

    // `catch` (not `allSettled` + rethrow): a failing handler already logged
    // inside the SDK, and surfacing it here would turn the webhook into a 500
    // that Discord retries.
    if (pendingTasks.length > 0) await Promise.all(pendingTasks).catch(() => {});

    return okResponse();
  };

  adapter[PATCHED_FLAG] = true;
};
