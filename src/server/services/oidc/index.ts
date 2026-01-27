import debug from 'debug';

import { createContextForInteractionDetails } from '@/libs/oidc-provider/http-adapter';
import { type OIDCProvider } from '@/libs/oidc-provider/provider';

import { getOIDCProvider } from './oidcProvider';

const log = debug('lobe-oidc:service');

export class OIDCService {
  private provider: OIDCProvider;

  constructor(provider: OIDCProvider) {
    this.provider = provider;
  }
  static async initialize() {
    const provider = await getOIDCProvider();

    return new OIDCService(provider);
  }

  async getInteractionDetails(uid: string) {
    const { req, res } = await createContextForInteractionDetails(uid);
    return this.provider.interactionDetails(req, res);
  }

  async getInteractionResult(uid: string, result: any) {
    const { req, res } = await createContextForInteractionDetails(uid);
    return this.provider.interactionResult(req, res, result);
  }

  async finishInteraction(uid: string, result: any) {
    const { req, res } = await createContextForInteractionDetails(uid);
    return this.provider.interactionFinished(req, res, result, { mergeWithLastSubmission: true });
  }

  async findOrCreateGrants(accountId: string, clientId: string, existingGrantId?: string) {
    // 2. Find or create Grant object
    let grant;
    if (existingGrantId) {
      // If a previous interaction step already associated a Grant
      grant = await this.provider.Grant.find(existingGrantId);
      log('Found existing grantId: %s', existingGrantId);
      if (grant) {
        const accountMismatch = grant.accountId && grant.accountId !== accountId;
        const clientMismatch = grant.clientId && grant.clientId !== clientId;

        if (accountMismatch || clientMismatch) {
          log(
            'Discarding stale grant %s due to mismatch (stored account=%s, client=%s; expected account=%s, client=%s)',
            existingGrantId,
            grant.accountId,
            grant.clientId,
            accountId,
            clientId,
          );
          try {
            await grant.destroy();
            log('Destroyed mismatched grant: %s', existingGrantId);
          } catch (error) {
            log('Failed to destroy mismatched grant %s: %O', existingGrantId, error);
          }
          grant = undefined;
        }
      } else {
        log('Existing grantId %s not found in storage, will create a new grant', existingGrantId);
      }
    }

    if (!grant) {
      // If not found or no existingGrantId, create a new one
      grant = new this.provider.Grant({
        accountId: accountId,
        clientId: clientId,
      });
      log('Created new Grant for account %s and client %s', accountId, clientId);
    }

    return grant;
  }

  async getClientMetadata(clientId: string) {
    const client = await this.provider.Client.find(clientId);
    return client?.metadata();
  }
}

export { getOIDCProvider } from './oidcProvider';
