// A caught error from a credential-decrypting loader is logged with %O. The error is
// opaque; the decrypted rows never reach the log.
import debug from 'debug';

import { AccountLinkModel, type DecryptedAccountLink } from './accountLink';
import { gateKeeper, serverDB } from './runtime';

const log = debug('lobe-server:gateway-pull');

export const collectPollingLinks = async (host: string, platform: string) => {
  let complete = true;
  let links: DecryptedAccountLink[] = [];

  try {
    links = await AccountLinkModel.findAllByPlatformWithCredentials(serverDB, platform, gateKeeper);
  } catch (err) {
    // A platform we could not read makes the answer incomplete, not empty.
    complete = false;
    log('Gateway pull[%s]: link listing failed for %s: %O', host, platform, err);
  }

  const connections = links
    .filter((link) => !!(link.credentials as { botToken?: string }).botToken)
    .map((link) => ({ connectionId: `${platform}:${link.tenantId}`, userId: link.userId }));

  return { complete, connections };
};
