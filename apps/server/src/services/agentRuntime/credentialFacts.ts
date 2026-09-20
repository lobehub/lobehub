import { CredsApiName, CredsIdentifier } from '@lobechat/builtin-tool-creds';

import type { StepPresentationData } from './types';

/**
 * Creds APIs that change what the credential list contains.
 * `injectCredsToSandbox` only reads, so a coding run that injects on every step
 * keeps the snapshot frozen when its operation was created.
 */
const MUTATING_API_NAMES = new Set<string>([
  CredsApiName.connectComposioService,
  CredsApiName.initiateOAuthConnect,
  CredsApiName.saveCreds,
]);

/**
 * Whether this step changed the run's own credentials. The list the next step
 * renders would then differ from the snapshot frozen at creation, so the run
 * goes back to reading it live.
 */
export const stepChangedCredentials = (toolsResult: StepPresentationData['toolsResult']): boolean =>
  !!toolsResult?.some(
    (result) => result.identifier === CredsIdentifier && MUTATING_API_NAMES.has(result.apiName),
  );
