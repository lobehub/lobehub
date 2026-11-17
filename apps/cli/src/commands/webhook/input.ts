import type {
  GenericWebhookSource,
  GenericWebhookTopicMode,
  InboundWebhookChannelDelivery,
} from '@lobechat/types';

/** `--no-<flag>` makes commander store `false`; that clears the field. */
export interface WebhookSettingsOptions {
  autoApprove?: boolean;
  channel?: string | false;
  instructions?: string | false;
  name?: string | false;
  thread?: string;
  topic?: string | false;
  topicMode?: string;
}

export interface WebhookSettingsInput {
  autoApprove?: boolean;
  delivery?: InboundWebhookChannelDelivery | null;
  instructions?: string | null;
  name?: string | null;
  topicId?: string | null;
  topicMode?: GenericWebhookTopicMode;
}

const TOPIC_MODES: GenericWebhookTopicMode[] = ['new', 'reuse'];

export const AUTO_APPROVE_REQUIRED =
  'Posting to a Channel needs --auto-approve: nobody can approve a tool call in a Channel, so those runs use tools without waiting for approval. Add --auto-approve to accept that.';

function topicModeOf(value: string | undefined): GenericWebhookTopicMode | undefined {
  if (value === undefined) return undefined;
  if (!TOPIC_MODES.includes(value as GenericWebhookTopicMode))
    throw new Error(`Invalid --topic-mode "${value}". Expected one of: ${TOPIC_MODES.join(', ')}.`);
  return value as GenericWebhookTopicMode;
}

function deliveryOf(channelId: string, threadId: string | undefined) {
  if (channelId.startsWith('cht_'))
    throw new Error(
      `${channelId} is a Thread id. Pass its Channel as --channel <chn_id> and the Thread as --thread ${channelId}.`,
    );
  if (threadId?.startsWith('chn_'))
    throw new Error(`${threadId} is a Channel id. Pass it as --channel, and a Thread as --thread.`);
  return threadId ? { channelId, threadId } : { channelId };
}

/**
 * The Topic flags: `--topic` pins a shared Topic, so it implies `--topic-mode reuse`; asking for
 * a new Topic per call while pinning one is a contradiction the server would silently drop.
 */
function topicSettings(
  options: Pick<WebhookSettingsOptions, 'topic' | 'topicMode'>,
  currentMode?: GenericWebhookTopicMode,
): Pick<WebhookSettingsInput, 'topicId' | 'topicMode'> {
  let topicMode = topicModeOf(options.topicMode);
  if (typeof options.topic === 'string') {
    if (topicMode === 'new')
      throw new Error('--topic picks the one shared topic, so it needs --topic-mode reuse.');
    if (!topicMode && currentMode !== 'reuse') topicMode = 'reuse';
  }
  return {
    ...(topicMode && { topicMode }),
    ...(options.topic !== undefined && { topicId: options.topic || null }),
  };
}

/** Turn `lh webhook create` flags into a `inboundWebhook.create` input. */
export function buildCreateInput(agentId: string, options: WebhookSettingsOptions) {
  if (options.thread && !options.channel)
    throw new Error('--thread needs the Channel it belongs to: pass --channel <chn_id> too.');
  const delivery = options.channel ? deliveryOf(options.channel, options.thread) : undefined;
  if (delivery && !options.autoApprove) throw new Error(AUTO_APPROVE_REQUIRED);

  return {
    agentId,
    ...(options.name && { name: options.name }),
    ...(options.instructions && { instructions: options.instructions }),
    ...topicSettings(options),
    ...(options.autoApprove && { autoApprove: true }),
    ...(delivery && { delivery }),
  };
}

/**
 * Turn `lh webhook edit` flags into the settings part of an `inboundWebhook.update` input. Only
 * the flags given change; `--no-name`, `--no-instructions`, `--no-topic` and `--no-channel` clear.
 * The current settings settle what the flags leave open: a `--thread` alone stays in the current
 * Channel, and auto-approval is checked against the delivery the webhook will have afterwards.
 * Renaming never changes the identifier the agent knows the webhook by.
 */
export function buildUpdateInput(
  current: GenericWebhookSource,
  options: WebhookSettingsOptions,
): WebhookSettingsInput {
  let delivery: InboundWebhookChannelDelivery | null | undefined;
  if (options.channel === false) {
    if (options.thread) throw new Error('--thread cannot be combined with --no-channel.');
    delivery = null;
  } else if (options.channel) {
    delivery = deliveryOf(options.channel, options.thread);
  } else if (options.thread) {
    if (!current.delivery)
      throw new Error(
        'This webhook does not post to a Channel yet: pass --channel <chn_id> with --thread.',
      );
    delivery = deliveryOf(current.delivery.channelId, options.thread);
  }

  const posts = delivery === undefined ? !!current.delivery : !!delivery;
  const autoApprove = options.autoApprove ?? current.autoApprove;
  if (posts && !autoApprove)
    throw new Error(
      delivery
        ? AUTO_APPROVE_REQUIRED
        : 'This webhook posts to a Channel, where nobody can approve a tool call, so it must keep auto-approval. Stop posting with --no-channel to turn auto-approval off.',
    );

  const input: WebhookSettingsInput = {
    ...(options.name !== undefined && { name: options.name || null }),
    ...(options.instructions !== undefined && { instructions: options.instructions || null }),
    ...topicSettings(options, current.topicMode),
    ...(options.autoApprove !== undefined && { autoApprove: options.autoApprove }),
    ...(delivery !== undefined && { delivery }),
  };
  if (Object.keys(input).length === 0)
    throw new Error('Nothing to change. Pass at least one option; see: lh webhook edit --help');
  return input;
}
