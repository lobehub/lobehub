import { describe, expect, it } from 'vitest';

import { MessageManifest } from './manifest';
import { MessageApiName } from './types';

const findApi = (name: string) => MessageManifest.api.find((api) => api.name === name);

describe('MessageManifest', () => {
  // A report the model emits as several send calls in one step must land in
  // the channel in the order it was written. The runtime only serializes
  // calls whose API carries `ordered`, so every outbound send has to say so.
  it('marks every outbound send API as ordered', () => {
    for (const name of [
      MessageApiName.sendMessage,
      MessageApiName.sendDirectMessage,
      MessageApiName.replyToThread,
      MessageApiName.sendMessengerPush,
    ]) {
      expect(findApi(name)?.ordered, name).toBe(true);
    }
  });

  it('leaves read-only APIs concurrent', () => {
    for (const name of [
      MessageApiName.readMessages,
      MessageApiName.searchMessages,
      MessageApiName.listChannels,
    ]) {
      expect(findApi(name)?.ordered, name).toBeUndefined();
    }
  });
});
