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

interface ForwardedInteractionAdapter {
  discordInteractionFetch: (
    path: string,
    method: string,
    body: Record<string, unknown>,
  ) => Promise<Response>;
  handleApplicationCommandInteraction: (
    interaction: ForwardedInteraction,
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

    // Gateway-forwarded interactions bypass Discord's HTTP webhook response path,
    // so we must send the deferred callback manually before dispatching handlers.
    await adapter.discordInteractionFetch(
      `/interactions/${interaction.id}/${interaction.token}/callback`,
      'POST',
      { type: responseType },
    );

    if (interaction.type === APPLICATION_COMMAND_INTERACTION) {
      adapter.handleApplicationCommandInteraction(interaction as ForwardedInteraction, options);
    } else {
      adapter.handleComponentInteraction(interaction as ForwardedInteraction, options);
    }

    return okResponse();
  };

  adapter[PATCHED_FLAG] = true;
};
