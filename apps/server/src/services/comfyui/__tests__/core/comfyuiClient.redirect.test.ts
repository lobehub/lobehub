import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import { afterEach, describe, expect, it } from 'vitest';

import { ComfyUIClientService } from '@/server/services/comfyui/core/comfyUIClientService';

/**
 * T-07 redirect-bypass regression (found in review): the ComfyUI SDK's HTTP
 * calls must stay behind the SSRF policy after the baseURL check passes. A
 * hostile ComfyUI endpoint can answer any request with a redirect to an
 * internal address, and the runtime fetch would follow it unfiltered.
 *
 * This test runs the real chain — no SDK or fetch mocks: a local server
 * stands in for the hostile ComfyUI host and 302s to the instance-metadata
 * address. `127.0.0.1` is allow-listed so the baseURL itself passes the
 * policy while the redirect target does not.
 */
describe('ComfyUIClientService redirect bypass', () => {
  let server: Server;

  afterEach(() => {
    server.close();
    delete process.env.SSRF_ALLOW_IP_ADDRESS_LIST;
  });

  it('blocks an SDK fetchApi redirect to the metadata address', async () => {
    server = createServer((_, res) => {
      res.writeHead(302, { location: 'http://169.254.169.254/latest/meta-data' });
      res.end();
    });
    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', resolve);
    });
    const { port } = server.address() as AddressInfo;
    process.env.SSRF_ALLOW_IP_ADDRESS_LIST = '127.0.0.1';

    const service = new ComfyUIClientService({ baseURL: `http://127.0.0.1:${port}` });
    const client = await (service as any).clientReady;

    try {
      await expect(client.fetchApi('/object_info')).rejects.toThrow(/SSRF blocked|not allowed/);
    } finally {
      client.destroy();
    }
  });
});
