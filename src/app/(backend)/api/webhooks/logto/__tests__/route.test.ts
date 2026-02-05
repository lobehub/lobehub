import { createHmac } from 'node:crypto';

import { describe, expect, it } from 'vitest';

interface UserDataUpdatedEvent {
  createdAt: string;
  data: {
    id: string;
    username: string;
    primaryEmail: string;
    primaryPhone: string | null;
    name: string;
    avatar: string | null;
    customData: Record<string, unknown>;
    identities: Record<string, unknown>;
    lastSignInAt: number;
    createdAt: number;
    updatedAt: number;
    profile: Record<string, unknown>;
    applicationId: string;
    isSuspended: boolean;
  };
  event: string;
  hookId: string;
  ip: string;
  matchedRoute: string;
  method: string;
  params: {
    userId: string;
  };
  path: string;
  status: number;
  userAgent: string;
}

const userDataUpdatedEvent: UserDataUpdatedEvent = {
  event: 'User.Data.Updated',
  createdAt: '2024-09-07T08:29:09.381Z',
  userAgent:
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36 Edg/128.0.0.0',
  ip: '223.104.76.217',
  path: '/users/rra41h9vmpnd',
  method: 'PATCH',
  status: 200,
  params: {
    userId: 'rra41h9vmpnd',
  },
  matchedRoute: '/users/:userId',
  data: {
    id: 'uid',
    username: 'test',
    primaryEmail: 'user@example.com',
    primaryPhone: null,
    name: 'test',
    avatar: null,
    customData: {},
    identities: {},
    lastSignInAt: 1725446291545,
    createdAt: 1725440405556,
    updatedAt: 1725697749337,
    profile: {},
    applicationId: 'appid',
    isSuspended: false,
  },
  hookId: 'hookId',
};

const LOGTO_WEBHOOK_SIGNING_KEY = 'logto-signing-key';

// Test Logto Webhooks in Local dev, here is some tips:
// - Replace the var `LOGTO_WEBHOOK_SIGNING_KEY` with the actual value in your `.env` file
// - Start web request: If you want to run the test, replace `describe.skip` with `describe` below

describe.skip('Test Logto Webhooks in Local dev', () => {
  // describe('Test Logto Webhooks in Local dev', () => {
  it('should send a POST request with logto headers', async () => {
    const url = 'http://localhost:3010/api/webhooks/logto'; // 替换为目标URL
    const data = userDataUpdatedEvent;
    //  Generate data signature
    const hmac = createHmac('sha256', LOGTO_WEBHOOK_SIGNING_KEY!);
    hmac.update(JSON.stringify(data));
    const signature = hmac.digest('hex');
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'logto-signature-sha-256': signature,
      },
      body: JSON.stringify(data),
    });
    expect(response.status).toBe(200); // 检查响应状态
  });
});
