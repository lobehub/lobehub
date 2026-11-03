import debug from 'debug';
import { interactionPolicy } from 'oidc-provider';

const { base } = interactionPolicy; // Import Check and base
const log = debug('lobe-oidc:interaction-policy');

/**
 * Create custom interaction policy
 */
export const createInteractionPolicy = () => {
  log('Creating custom interaction policy');
  const policy = base();

  log('Base policy details: %O', {
    promptNames: Array.from(policy.keys()),
    size: policy.length,
  });

  const loginPrompt = policy.get('login');
  log('Accessing login prompt from policy: %O', !!loginPrompt);

  if (loginPrompt) {
    log('Login prompt details: %O', {
      checks: Array.from(loginPrompt.checks.keys()),
      name: loginPrompt.name,
      requestable: loginPrompt.requestable,
    });
  } else {
    console.warn(
      "Could not find 'login' prompt in the base policy. Custom session check not applied.",
    );
    log('WARNING: login prompt not found in base policy');
  }

  log('Custom interaction policy created successfully');
  return policy;
};
