export const HETEROGENEOUS_PROVIDER_BINDING_LOCAL_ONLY_ERROR =
  'Heterogeneous agent provider binding is only supported for Desktop local execution.';

/**
 * Desktop main resolves the binding's providerId in the PERSONAL scope only
 * (deliberately no workspace header — see `providerBindingPort`). A workspace
 * agent's binding would have been configured against workspace-scoped
 * providers, so running it locally could silently resolve a personal provider
 * that shares the same id (builtin ids like `anthropic` collide across scopes)
 * and bill the wrong account. Blocked before IPC for every entry point.
 */
export const HETEROGENEOUS_PROVIDER_BINDING_PERSONAL_ONLY_ERROR =
  'Heterogeneous agent provider binding is not supported for workspace agents.';

/** @deprecated Use HETEROGENEOUS_PROVIDER_BINDING_LOCAL_ONLY_ERROR. */
export const CLAUDE_CODE_API_LOCAL_ONLY_ERROR = HETEROGENEOUS_PROVIDER_BINDING_LOCAL_ONLY_ERROR;
