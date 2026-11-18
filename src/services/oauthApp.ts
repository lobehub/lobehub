import { lambdaClient } from '@/libs/trpc/client';
import {
  type CreateOAuthAppParams,
  type OAuthAppItem,
  type UpdateOAuthAppParams,
} from '@/types/oauthApp';

class OAuthAppService {
  create = (params: CreateOAuthAppParams) => lambdaClient.oauthApp.create.mutate(params);

  /** A single-use initial access token for RFC 7591 dynamic registration. */
  createRegistrationToken = () => lambdaClient.oauthApp.createRegistrationToken.mutate();

  delete = (id: string) => lambdaClient.oauthApp.delete.mutate({ id });

  /** `undefined` when the app does not exist or is not visible to the caller. */
  getById = async (id: string) =>
    (await lambdaClient.oauthApp.getById.query({ id })) as OAuthAppItem | undefined;

  list = async () => (await lambdaClient.oauthApp.list.query()) as OAuthAppItem[];

  /** Which OAuth open platform capabilities the server switched on. */
  getOpenPlatform = () => lambdaClient.oauthApp.openPlatform.query();

  rotateSecret = (id: string) => lambdaClient.oauthApp.rotateSecret.mutate({ id });

  setEnabled = (id: string, enabled: boolean) =>
    lambdaClient.oauthApp.setEnabled.mutate({ enabled, id });

  update = (id: string, value: UpdateOAuthAppParams) =>
    lambdaClient.oauthApp.update.mutate({ id, value });
}

export const oauthAppService = new OAuthAppService();
