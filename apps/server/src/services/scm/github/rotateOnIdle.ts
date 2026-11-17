import debug from 'debug';

import { ScmCredentialGrantModel } from '@/database/models/scm';
import type { LobeChatDatabase } from '@/database/type';

import { describeGitHubError } from './errorLog';
import { GithubUserTokenService } from './userToken';

const log = debug('lobe-server:scm:rotate-on-idle');

export const rotateRequesterTokenIfIdle = async (
  db: LobeChatDatabase,
  operationId: string,
): Promise<void> => {
  try {
    const requesterIds = await ScmCredentialGrantModel.issuedRequesterIds(db, operationId);
    for (const requesterUserId of requesterIds) {
      if (await ScmCredentialGrantModel.hasOtherRunningIssued(db, requesterUserId, operationId)) {
        continue;
      }
      await new GithubUserTokenService(db).rotate(requesterUserId);
    }
  } catch (error) {
    log('rotation after op=%s failed: %s', operationId, describeGitHubError(error));
  }
};
