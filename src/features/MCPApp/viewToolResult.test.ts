import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { restoreMediaForView } from './viewToolResult';

const { environment, readStoredMcpMedia } = vi.hoisted(() => ({
  environment: { isDesktop: true },
  readStoredMcpMedia: vi.fn(),
}));

vi.mock('@lobechat/const', async (importOriginal) => ({
  ...((await importOriginal()) as Record<string, unknown>),
  get isDesktop() {
    return environment.isDesktop;
  },
}));

vi.mock('@/utils/electron/ipc', () => ({
  ensureElectronIpc: () => ({ mcp: { readStoredMcpMedia } }),
}));

const text = { text: 'sunny', type: 'text' as const };

describe('restoreMediaForView', () => {
  beforeEach(() => {
    environment.isDesktop = true;
    readStoredMcpMedia.mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('reads an uploaded image back as base64', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(new Uint8Array([104, 105])));
    vi.stubGlobal('fetch', fetchMock);

    const result = await restoreMediaForView({
      content: [
        text,
        { data: 'https://files.example.com/a.png', mimeType: 'image/png', type: 'image' },
      ],
    });

    expect(fetchMock).toHaveBeenCalledWith('https://files.example.com/a.png', {
      credentials: 'include',
    });
    expect(result.content).toEqual([text, { data: 'aGk=', mimeType: 'image/png', type: 'image' }]);
  });

  it("reads this desktop's stored audio back through the desktop", async () => {
    readStoredMcpMedia.mockResolvedValue('aGk=');

    const result = await restoreMediaForView({
      content: [{ data: 'desktop://mcp/audio/2026/a.mp3', mimeType: 'audio/mpeg', type: 'audio' }],
    });

    expect(readStoredMcpMedia).toHaveBeenCalledWith('desktop://mcp/audio/2026/a.mp3');
    expect(result.content).toEqual([{ data: 'aGk=', mimeType: 'audio/mpeg', type: 'audio' }]);
  });

  it('leaves out media it cannot read instead of handing it over broken', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 404 })));

    const result = await restoreMediaForView({
      content: [
        text,
        { data: 'https://files.example.com/gone.png', mimeType: 'image/png', type: 'image' },
      ],
    });

    expect(result.content).toEqual([text]);
  });

  it('keeps media that already is base64', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const image = { data: 'aGk=', mimeType: 'image/png', type: 'image' as const };

    expect((await restoreMediaForView({ content: [image] })).content).toEqual([image]);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
