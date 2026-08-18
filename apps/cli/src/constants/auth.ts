import { CLI_API_KEY_ENV_NAMES } from './identity';

/**
 * The API key variable's primary name — what error messages tell users to set.
 *
 * Reading the environment goes through `readCliApiKeyEnv()` instead, which also
 * accepts the older names in `CLI_API_KEY_ENV_NAMES`.
 */
export const CLI_API_KEY_ENV = CLI_API_KEY_ENV_NAMES[0]!;
export { CLI_API_KEY_ENV_NAMES, readCliApiKeyEnv } from './identity';
