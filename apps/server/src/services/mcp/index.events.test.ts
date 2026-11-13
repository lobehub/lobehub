// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { startEventsServer } from '@/libs/mcp/__tests__/fixtures/eventsServer';
import { getMcpEventErrorName } from '@/libs/mcp/events/errors';

import { MCPService } from './index';

vi.mock('./deps', () => ({ mcpSystemDepsCheckService: {} }));

describe('MCPService events session integration', () => {
  let fixture: Awaited<ReturnType<typeof startEventsServer>>;
  let service: MCPService;
  beforeEach(async () => {
    fixture = await startEventsServer();
    service = new MCPService();
  });
  afterEach(async () => {
    await Promise.all([...service['clients'].values()].map((client) => client.disconnect()));
    await fixture.close();
    vi.restoreAllMocks();
  });
  const params = () => ({ name: 'fixture', type: 'http' as const, url: fixture.url });

  it('caches separately for events-enabled and plain sessions', async () => {
    expect(await service.getEventsCapability(params(), { mcpEvents: false })).toMatchObject({
      supported: false,
    });
    expect(await service.getEventsCapability(params())).toMatchObject({ supported: true });
    expect((await service.listEvents(params())).length).toBe(2);
    expect(fixture.requests.filter((request) => request.method === 'server/discover')).toHaveLength(
      2,
    );
  });

  it('preserves an upstream SEP error through the TRPC service boundary', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const error: unknown = await service
      .subscribeEvent(params(), {
        name: 'CallbackEndpointError',
        delivery: {
          mode: 'webhook',
          url: 'https://receiver.example/callback',
          secret: 'whsec_fixture',
        },
      })
      .catch((error: unknown) => error);
    expect(getMcpEventErrorName(error)).toBe('CallbackEndpointError');
  });
});
