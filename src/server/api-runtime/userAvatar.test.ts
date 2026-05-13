// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { GET } from '@/app/(backend)/webapi/user/avatar/[id]/[image]/route';
import honoApp from '@/server/hono';
import { UserService } from '@/server/services/user';

const getUserAvatar = vi.fn();

vi.mock('@/database/server', () => ({
  serverDB: {},
}));

vi.mock('@/server/services/user', () => ({
  UserService: vi.fn(() => ({
    getUserAvatar,
  })),
}));

const createRequest = (headers?: HeadersInit) =>
  new Request('https://example.com/webapi/user/avatar/user-1/avatar.png', { headers });

const createSegmentData = () => ({
  params: Promise.resolve({ id: 'user-1', image: 'avatar.png' }),
});

const expectAvatarNotFound = async (response: Response) => {
  expect(response.status).toBe(404);
  expect(await response.text()).toBe('Avatar not found');
};

beforeEach(() => {
  vi.clearAllMocks();
  getUserAvatar.mockResolvedValue(null);
});

describe('/webapi/user/avatar/:id/:image runtime parity', () => {
  it('keeps the Next.js route as the default path', async () => {
    const response = await GET(createRequest(), createSegmentData());

    expect(response.headers.get('x-lobe-api-runtime')).toBe('next');
    expect(response.headers.get('x-lobe-api-runtime-reason')).toBe('default');
    expect(UserService).toHaveBeenCalled();
    expect(getUserAvatar).toHaveBeenCalledWith('user-1', 'avatar.png');
    await expectAvatarNotFound(response);
  });

  it('returns the same response through the Hono gray-release path', async () => {
    const response = await GET(
      createRequest({ 'x-lobe-api-runtime': 'hono' }),
      createSegmentData(),
    );

    expect(response.headers.get('x-lobe-api-runtime')).toBe('hono');
    expect(response.headers.get('x-lobe-api-runtime-reason')).toBe('request-header');
    expect(getUserAvatar).toHaveBeenCalledWith('user-1', 'avatar.png');
    await expectAvatarNotFound(response);
  });

  it('can be served by the root Hono runtime app', async () => {
    const response = await honoApp.fetch(createRequest());

    expect(getUserAvatar).toHaveBeenCalledWith('user-1', 'avatar.png');
    await expectAvatarNotFound(response);
  });
});
