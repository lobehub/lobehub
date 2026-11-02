// @vitest-environment node
import { inArray } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../core/getTestDB';
import { users } from '../../schemas';
import type { LobeChatDatabase } from '../../type';
import { OidcClientModel } from '../oidcClient';

const serverDB: LobeChatDatabase = await getTestDB();

const userId = 't863-oidc-cov-user';
const oidcClientModel = new OidcClientModel(serverDB, userId);

beforeEach(async () => {
  await serverDB.insert(users).values({ id: userId });
});

afterEach(async () => {
  // OIDC clients cascade with their owner.
  await serverDB.delete(users).where(inArray(users.id, [userId]));
});

describe('OidcClientModel coverage', () => {
  it('stores an empty redirect list for a web app created without redirect URIs', async () => {
    const { client, secret } = await oidcClientModel.create({ name: 'No redirects', type: 'web' });

    expect(secret).toBeUndefined();
    expect(client).toMatchObject({
      applicationType: 'web',
      name: 'No redirects',
      redirectUris: [],
      responseTypes: ['code'],
    });
  });
});
