import debug from 'debug';
import { interactionPolicy } from 'oidc-provider';

import { needsWebSessionLogin } from './acceptanceReview';

const { base, Check } = interactionPolicy;
const log = debug('lobe-oidc:interaction-policy');

export const createInteractionPolicy = () => {
  const policy = base();
  const loginPrompt = policy.get('login');

  if (!loginPrompt) {
    console.warn("Could not find 'login' prompt in the base policy.");
    log('WARNING: login prompt not found in base policy');
    return policy;
  }

  loginPrompt.checks.add(
    new Check('web_session_login', 'the web session decides who signs in', (ctx) =>
      needsWebSessionLogin(ctx.oidc.client?.clientId, Boolean(ctx.oidc.result?.login))
        ? Check.REQUEST_PROMPT
        : Check.NO_NEED_TO_PROMPT,
    ),
  );

  return policy;
};
