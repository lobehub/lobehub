import { describe, expect, it } from 'vitest';

import { taskGatewayAvailability } from './taskGatewayAvailability';

describe('taskGatewayAvailability', () => {
  it.each([
    [false, false, undefined, undefined, 'loading'],
    [true, false, undefined, undefined, 'error'],
    [true, true, false, undefined, 'unavailable'],
    [true, true, true, undefined, 'unavailable'],
    [true, true, false, 'https://gateway.example.com', 'unavailable'],
    [true, true, true, 'https://gateway.example.com', 'available'],
  ] as const)(
    'resolves initialized=%s loaded=%s enabled=%s url=%s to %s',
    (serverConfigInit, serverConfigLoaded, enableGatewayMode, agentGatewayUrl, expected) => {
      expect(
        taskGatewayAvailability({
          serverConfig: { agentGatewayUrl, aiProvider: {}, enableGatewayMode, telemetry: {} },
          serverConfigInit,
          serverConfigLoaded,
        }),
      ).toBe(expected);
    },
  );
});
