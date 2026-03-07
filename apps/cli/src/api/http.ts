import { getValidToken } from '../auth/refresh';
import { log } from '../utils/logger';

export async function getAuthInfo(): Promise<{ accessToken: string; serverUrl: string }> {
  const result = await getValidToken();
  if (!result) {
    log.error("No authentication found. Run 'lh login' first.");
    process.exit(1);
  }

  const { serverUrl, accessToken } = result!.credentials;
  return { accessToken, serverUrl: serverUrl.replace(/\/$/, '') };
}
