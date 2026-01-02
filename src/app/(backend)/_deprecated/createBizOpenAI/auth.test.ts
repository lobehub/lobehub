// @vitest-environment node
import { checkAuth } from './auth';

describe('checkAuth', () => {
  it('should pass with oauth authorized', () => {
    const { auth } = checkAuth({ oauthAuthorized: true });
    expect(auth).toBe(true);
  });

  it('should pass with api key', () => {
    const { auth } = checkAuth({ apiKey: 'test-api-key' });
    expect(auth).toBe(true);
  });

  it('should pass with no params', () => {
    const { auth } = checkAuth({});
    expect(auth).toBe(true);
  });
});
