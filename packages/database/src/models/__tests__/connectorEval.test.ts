// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';

import {
  EvalConnectorUpdateError,
  normalizeEvalConnectorPatch,
  withoutEvalConnectorMarker,
} from '../connectorEval';

const marker = { datasetId: '11111111-1111-4111-8111-111111111111' };

/** A stored, imported mock connection: the marker plus optional header set. */
const evalCurrent = (
  overrides: Partial<{ credentials: null | string; customHeaders: Record<string, string> }> = {},
) => ({
  credentials: overrides.credentials ?? null,
  metadata: {
    agentEval: marker,
    ...(overrides.customHeaders ? { customHeaders: overrides.customHeaders } : {}),
  } as any,
  mcpServerUrl: 'https://mock.example.com/mcp',
});

describe('withoutEvalConnectorMarker', () => {
  it('passes empty metadata through untouched', () => {
    expect(withoutEvalConnectorMarker(undefined)).toBeUndefined();
    expect(withoutEvalConnectorMarker(null)).toBeNull();
  });

  it('drops the import marker from a submitted metadata object', () => {
    expect(withoutEvalConnectorMarker({ agentEval: marker, customHeaders: {} } as any)).toEqual({
      customHeaders: {},
    });
  });
});

describe('normalizeEvalConnectorPatch outside an imported connection', () => {
  it('returns the patch as-is when no metadata is submitted', async () => {
    const patch = { name: 'Renamed' };
    await expect(
      normalizeEvalConnectorPatch({ credentials: null, metadata: null, mcpServerUrl: null }, patch),
    ).resolves.toEqual(patch);
  });

  it('strips a client-supplied marker from an ordinary connector patch', async () => {
    const result = await normalizeEvalConnectorPatch(
      { credentials: null, metadata: null, mcpServerUrl: null } as any,
      { metadata: { agentEval: marker, customHeaders: { A: '1' } } as any },
    );

    expect(result.metadata).toEqual({ customHeaders: { A: '1' } });
  });
});

describe('normalizeEvalConnectorPatch on an imported mock connection', () => {
  it('rejects assigning the mock connection to a normal agent', async () => {
    await expect(
      normalizeEvalConnectorPatch(evalCurrent(), { agentId: 'agent-1' } as any),
    ).rejects.toThrow(EvalConnectorUpdateError);
    await expect(
      normalizeEvalConnectorPatch(evalCurrent(), {
        metadata: { mountedByAgentId: 'agent-1' },
      } as any),
    ).rejects.toThrow('cannot be assigned to a normal Agent');
  });

  it('rejects MCP addresses that carry embedded credentials', async () => {
    for (const mcpServerUrl of [
      'ftp://mock.example.com/mcp',
      'https://user:pass@mock.example.com/mcp',
      'https://mock.example.com/mcp?token=1',
      'https://mock.example.com/mcp#fragment',
      'not-a-url',
    ]) {
      await expect(
        normalizeEvalConnectorPatch(evalCurrent(), { mcpServerUrl } as any),
      ).rejects.toThrow('Use an HTTP MCP address without embedded credentials, query or fragment');
    }
  });

  it('accepts a plain https address swap when nothing is authenticated', async () => {
    const result = await normalizeEvalConnectorPatch(evalCurrent(), {
      mcpServerUrl: 'https://other.example.com/mcp',
    } as any);

    expect(result.status).toBe('disconnected');
    expect(result.credentials).toBeUndefined();
  });

  it('refuses a URL swap that would drop stored authentication', async () => {
    await expect(
      normalizeEvalConnectorPatch(evalCurrent({ credentials: 'cipher' }), {
        mcpServerUrl: 'https://other.example.com/mcp',
      } as any),
    ).rejects.toThrow('Clear or replace authentication when changing a mock connection address');
  });

  it('treats an explicit credential clear on a URL edit as authoritative', async () => {
    const result = await normalizeEvalConnectorPatch(
      evalCurrent({ credentials: 'cipher', customHeaders: { 'X-Token': '1' } }),
      { credentials: null, mcpServerUrl: 'https://other.example.com/mcp' } as any,
    );

    expect(result).toMatchObject({
      credentials: null,
      status: 'disconnected',
      tokenExpiresAt: null,
    });
    expect(result.metadata).toEqual({ agentEval: marker });
  });

  it('does not treat a credential-free patch as a URL swap when the address is unchanged', async () => {
    const result = await normalizeEvalConnectorPatch(evalCurrent(), {
      mcpServerUrl: 'https://mock.example.com/mcp',
    } as any);

    expect(result.status).toBeUndefined();
  });

  describe('header migration', () => {
    it('migrates stored headers when the editor does not resend them', async () => {
      const result = await normalizeEvalConnectorPatch(
        evalCurrent({ customHeaders: { 'X-Stored': '1' } }),
        { name: 'Renamed' } as any,
      );

      expect(JSON.parse(result.credentials as string)).toEqual({
        headers: { 'X-Stored': '1' },
        type: 'header',
      });
      // Headers never leak into stored metadata once they own the credential slot.
      expect(result.metadata).toEqual({ agentEval: marker });
      expect(result.status).toBe('disconnected');
      expect(result.tokenExpiresAt).toBeNull();
    });

    it('does not migrate stored headers when the caller supplies credentials', async () => {
      const result = await normalizeEvalConnectorPatch(
        evalCurrent({ customHeaders: { 'X-Stored': '1' } }),
        { credentials: JSON.stringify({ type: 'bearer', token: 't' }) } as any,
      );

      expect(JSON.parse(result.credentials as string)).toEqual({ type: 'bearer', token: 't' });
      expect(result.metadata).toEqual({ agentEval: marker });
    });

    it('reads stored credentials when headers are resubmitted and storage is available', async () => {
      const decrypt = vi.fn().mockResolvedValue({
        plaintext: JSON.stringify({ headers: { Authorization: 'Bearer old' }, type: 'header' }),
      });

      const result = await normalizeEvalConnectorPatch(
        evalCurrent({ credentials: 'cipher' }),
        { metadata: { customHeaders: { 'X-New': '1' } } as any },
        decrypt,
      );

      expect(decrypt).toHaveBeenCalledWith('cipher');
      // Without an explicit credential the resubmitted header set replaces the stored one.
      expect(JSON.parse(result.credentials as string)).toEqual({
        headers: { 'X-New': '1' },
        type: 'header',
      });
    });

    it('clears stored headers when the editor sends an empty header set', async () => {
      const result = await normalizeEvalConnectorPatch(evalCurrent(), {
        metadata: { customHeaders: {} } as any,
      });

      expect(result.credentials).toBeNull();
      expect(result.metadata).toEqual({ agentEval: marker });
    });

    it('falls back to an empty set when the header key is present but undefined', async () => {
      const result = await normalizeEvalConnectorPatch(evalCurrent(), {
        metadata: { customHeaders: undefined } as any,
      });

      expect(result.credentials).toBeNull();
    });

    it('merges resubmitted headers into a decrypted header credential', async () => {
      const decrypt = vi.fn().mockResolvedValue({
        plaintext: JSON.stringify({ headers: { 'X-Old': '1' }, type: 'header' }),
      });

      const result = await normalizeEvalConnectorPatch(
        evalCurrent({ credentials: 'cipher' }),
        {
          credentials: JSON.stringify({ headers: { 'X-Sent': '1' }, type: 'header' }),
          metadata: { customHeaders: { 'X-New': '2' } } as any,
        },
        decrypt,
      );

      expect(JSON.parse(result.credentials as string)).toEqual({
        headers: { 'X-New': '2', 'X-Sent': '1' },
        type: 'header',
      });
    });
  });

  describe('credential precedence', () => {
    it('requires secure storage when stored credentials must be read for a header edit', async () => {
      await expect(
        normalizeEvalConnectorPatch(evalCurrent({ credentials: 'cipher' }), {
          metadata: { customHeaders: { 'X-New': '1' } } as any,
        }),
      ).rejects.toThrow('Secure connection storage is unavailable');
    });

    it('hides decrypt failures behind a stable error', async () => {
      await expect(
        normalizeEvalConnectorPatch(
          evalCurrent({ credentials: 'cipher' }),
          { metadata: { customHeaders: { 'X-New': '1' } } as any },
          vi.fn().mockRejectedValue(new Error('vault down')),
        ),
      ).rejects.toThrow('Could not securely read the mock connection');
    });

    it('keeps OAuth tokens untouched when no custom headers are submitted', async () => {
      const result = await normalizeEvalConnectorPatch(evalCurrent(), {
        credentials: JSON.stringify({ accessToken: 'a', type: 'oauth2' }),
      } as any);

      expect(JSON.parse(result.credentials as string)).toEqual({
        accessToken: 'a',
        type: 'oauth2',
      });
      // OAuth keeps its own expiry bookkeeping instead of being reset.
      expect(result.tokenExpiresAt).toBeUndefined();
    });

    it('rejects custom headers alongside an OAuth login', async () => {
      await expect(
        normalizeEvalConnectorPatch(evalCurrent(), {
          credentials: JSON.stringify({ accessToken: 'a', type: 'oauth2' }),
          metadata: { customHeaders: { Authorization: 'Bearer x' } } as any,
        } as any),
      ).rejects.toThrow('Use OAuth authentication without custom headers for this mock connection');
    });

    it('folds a bearer token into the Authorization header', async () => {
      const result = await normalizeEvalConnectorPatch(
        evalCurrent(),
        {
          credentials: JSON.stringify({ token: 't', type: 'bearer' }),
          metadata: { customHeaders: { 'authorization': 'Bearer stale', 'X-Extra': '1' } } as any,
        },
        undefined,
      );

      expect(JSON.parse(result.credentials as string)).toEqual({
        headers: { 'X-Extra': '1', 'Authorization': 'Bearer t' },
        type: 'header',
      });
    });

    it('leaves a bearer credential alone when no headers accompany it', async () => {
      const result = await normalizeEvalConnectorPatch(evalCurrent(), {
        credentials: JSON.stringify({ token: 't', type: 'bearer' }),
      } as any);

      expect(JSON.parse(result.credentials as string)).toEqual({ token: 't', type: 'bearer' });
      expect(result.status).toBe('disconnected');
    });

    it('promotes an api key to the Authorization header when headers are edited', async () => {
      const result = await normalizeEvalConnectorPatch(evalCurrent(), {
        credentials: JSON.stringify({ apiKey: 'k', type: 'apikey' }),
        metadata: { customHeaders: { 'X-Extra': '1' } } as any,
      } as any);

      expect(JSON.parse(result.credentials as string)).toEqual({
        headers: { 'X-Extra': '1', 'Authorization': 'Bearer k' },
        type: 'header',
      });
    });

    it('keeps an api key when no headers are submitted', async () => {
      const result = await normalizeEvalConnectorPatch(evalCurrent(), {
        credentials: JSON.stringify({ apiKey: 'k', type: 'apikey' }),
      } as any);

      expect(JSON.parse(result.credentials as string)).toEqual({ apiKey: 'k', type: 'apikey' });
    });

    it('clears the credential without touching the address', async () => {
      const result = await normalizeEvalConnectorPatch(evalCurrent({ credentials: 'cipher' }), {
        credentials: null,
      } as any);

      expect(result).toMatchObject({
        credentials: null,
        status: 'disconnected',
        tokenExpiresAt: null,
      });
    });

    it('keeps an OAuth login when the header form is submitted empty', async () => {
      const result = await normalizeEvalConnectorPatch(evalCurrent(), {
        credentials: JSON.stringify({ accessToken: 'a', type: 'oauth2' }),
        metadata: { customHeaders: {} } as any,
      } as any);

      expect(JSON.parse(result.credentials as string)).toEqual({
        accessToken: 'a',
        type: 'oauth2',
      });
      expect(result.tokenExpiresAt).toBeUndefined();
    });

    it('keeps a bearer token when the header form is submitted empty', async () => {
      const result = await normalizeEvalConnectorPatch(evalCurrent(), {
        credentials: JSON.stringify({ token: 't', type: 'bearer' }),
        metadata: { customHeaders: {} } as any,
      } as any);

      expect(JSON.parse(result.credentials as string)).toEqual({ token: 't', type: 'bearer' });
    });

    it.each([
      ['invalid JSON', '{'],
      ['an unknown type', JSON.stringify({ type: 'saml' })],
      ['a header credential without headers', JSON.stringify({ type: 'header' })],
      [
        'a header value with a line break',
        JSON.stringify({ headers: { A: 'a\r\nb' }, type: 'header' }),
      ],
      [
        'a header name with a space',
        JSON.stringify({ headers: { 'bad name': '1' }, type: 'header' }),
      ],
      ['a bearer token with a line break', JSON.stringify({ token: 'a\nb', type: 'bearer' })],
      ['an api key with a line break', JSON.stringify({ apiKey: 'a\nb', type: 'apikey' })],
      ['an oauth login without a token', JSON.stringify({ type: 'oauth2' })],
    ])('rejects %s', async (_label, credentials) => {
      await expect(
        normalizeEvalConnectorPatch(evalCurrent(), { credentials } as any),
      ).rejects.toThrow(EvalConnectorUpdateError);
    });
  });

  describe('metadata merge', () => {
    it('drops a submitted metadata object when only stored headers exist', async () => {
      const result = await normalizeEvalConnectorPatch(
        evalCurrent({ customHeaders: { 'X-Stored': '1' } }),
        { metadata: null } as any,
      );

      expect(result.metadata).toEqual({ agentEval: marker });
    });

    it('falls back to an empty metadata object if the stored row vanishes mid-normalisation', async () => {
      // Defensive `?? {}` only: the marker read and the header read both see the
      // stored row, while the merge step sees a row that no longer exists.
      let reads = 0;
      const current = {
        credentials: null,
        get metadata() {
          reads += 1;
          return reads <= 2 ? { agentEval: marker, customHeaders: { 'X-Stored': '1' } } : null;
        },
        mcpServerUrl: 'https://mock.example.com/mcp',
      };

      const result = await normalizeEvalConnectorPatch(current as any, { name: 'Renamed' } as any);

      expect(result.metadata).toEqual({ agentEval: marker });
    });
  });
});
