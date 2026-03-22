import { MessageToolIdentifier } from '@lobechat/builtin-tool-message';
import {
  MessageExecutionRuntime,
  type MessageRuntimeService,
} from '@lobechat/builtin-tool-message/executionRuntime';

import type { ServerRuntimeRegistration } from './types';

/**
 * Stub implementation of MessageRuntimeService.
 *
 * Platform adapters (Discord, Telegram, Slack, etc.) will replace these stubs
 * with real API calls once the corresponding integrations are configured.
 * Each platform adapter should implement the MessageRuntimeService interface
 * and be selected based on the `platform` parameter in the tool call.
 */
class StubMessageService implements MessageRuntimeService {
  private unsupported(action: string): never {
    throw new Error(
      `Message tool action "${action}" is not yet configured. ` +
        'Please configure a messaging platform integration (Discord, Telegram, Slack, etc.) to use this tool.',
    );
  }

  sendMessage = async () => this.unsupported('sendMessage');
  readMessages = async () => this.unsupported('readMessages');
  editMessage = async () => this.unsupported('editMessage');
  deleteMessage = async () => this.unsupported('deleteMessage');
  searchMessages = async () => this.unsupported('searchMessages');
  reactToMessage = async () => this.unsupported('reactToMessage');
  getReactions = async () => this.unsupported('getReactions');
  pinMessage = async () => this.unsupported('pinMessage');
  unpinMessage = async () => this.unsupported('unpinMessage');
  listPins = async () => this.unsupported('listPins');
  getChannelInfo = async () => this.unsupported('getChannelInfo');
  listChannels = async () => this.unsupported('listChannels');
  getMemberInfo = async () => this.unsupported('getMemberInfo');
  createThread = async () => this.unsupported('createThread');
  listThreads = async () => this.unsupported('listThreads');
  replyToThread = async () => this.unsupported('replyToThread');
  createPoll = async () => this.unsupported('createPoll');
}

const stubService = new StubMessageService();
const runtime = new MessageExecutionRuntime({ service: stubService });

export const messageRuntime: ServerRuntimeRegistration = {
  factory: () => runtime,
  identifier: MessageToolIdentifier,
};
