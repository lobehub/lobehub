import { formatSandboxWorkspacePromptVariables } from '@lobechat/builtin-tool-cloud-sandbox';
import { getShellSyntaxGuidance } from '@lobechat/builtin-tool-local-system';
import type { VariableGenerators } from '@lobechat/context-engine';

import type { ContextVariables } from './types';

export interface CreateVariableGeneratorsParams {
  model?: string;
  provider?: string;
  /** IANA timezone the temporal placeholders render in. Defaults to UTC. */
  timezone?: string;
  /** Host-resolved values; each wins over the core default for the same key. */
  variables?: ContextVariables;
}

/**
 * Placeholder generators for the system role and tool prompts.
 *
 * Temporal values are localized to the run's timezone (prefer the coarse
 * `{{date}}` / `{{hour}}` in prompts: fine-grained values change every request
 * and break prompt caching). Everything a host may know better — the user's
 * locale and identity, the bound device's paths and shell, credential lists —
 * arrives through `variables` and overrides the defaults below; the defaults
 * exist so an unresolved placeholder never leaks its literal `{{…}}` token
 * into the prompt.
 */
export const createVariableGenerators = ({
  model,
  provider,
  timezone,
  variables,
}: CreateVariableGeneratorsParams): VariableGenerators => {
  const tz = timezone || 'UTC';
  // h23 keeps midnight as "00" instead of "24".
  const timeParts = (): Record<string, string> => {
    const parts = new Intl.DateTimeFormat('en-US', {
      day: '2-digit',
      hour: '2-digit',
      hourCycle: 'h23',
      minute: '2-digit',
      month: '2-digit',
      second: '2-digit',
      timeZone: tz,
      year: 'numeric',
    }).formatToParts(new Date());
    return Object.fromEntries(parts.map((part) => [part.type, part.value]));
  };

  const defaults: VariableGenerators = {
    // --- time ---
    date: () => new Date().toLocaleDateString('en-US', { dateStyle: 'full', timeZone: tz }),
    datetime: () => new Date().toLocaleString('en-US', { timeZone: tz }),
    day: () => timeParts().day,
    hour: () => timeParts().hour,
    iso: () => new Date().toISOString(),
    locale: () => 'en-US',
    minute: () => timeParts().minute,
    month: () => timeParts().month,
    second: () => timeParts().second,
    time: () => new Date().toLocaleTimeString('en-US', { timeStyle: 'medium', timeZone: tz }),
    timestamp: () => Date.now().toString(),
    timezone: () => tz,
    weekday: () => new Date().toLocaleDateString('en-US', { timeZone: tz, weekday: 'long' }),
    year: () => timeParts().year,

    // The creds tool's session context renders the calendar date.
    session_date: () =>
      new Intl.DateTimeFormat('en-US', {
        day: 'numeric',
        month: 'long',
        timeZone: tz,
        weekday: 'long',
        year: 'numeric',
      }).format(new Date()),

    // --- model ---
    model: () => model ?? '',
    provider: () => provider ?? '',

    // --- device leak guards: a run without a bound device still renders the
    // local-system prompt, so describe the unknown instead of leaking the token.
    arch: () => 'unknown',
    defaultShell: () =>
      'the platform default shell (PowerShell on Windows, /bin/sh on macOS/Linux)',
    desktopPath: () => '(not reported)',
    documentsPath: () => '(not reported)',
    downloadsPath: () => '(not reported)',
    homePath: () => '(not reported)',
    hostname: () => 'unknown',
    musicPath: () => '(not reported)',
    picturesPath: () => '(not reported)',
    platform: () => 'unknown',
    shellSyntaxGuidance: () => getShellSyntaxGuidance(undefined),
    userDataPath: () => '(not reported)',
    videosPath: () => '(not reported)',
    workingDirectory: () => '(not specified, use user Home directory as default)',
    // Leak-guards for the cloud-sandbox `{{sandbox_workspace}}` /
    // `{{sandbox_session_files}}` sections. The persistent-workspace wording
    // arrives through `variables` only for a run that actually got one
    // (entitlement claim AND persistent mode); every other run renders the
    // original ephemeral-session text rather than leaking the literal tokens.
    sandbox_session_files: () => formatSandboxWorkspacePromptVariables().sandbox_session_files,
    sandbox_workspace: () => formatSandboxWorkspacePromptVariables().sandbox_workspace,
  };

  return {
    ...defaults,
    ...Object.fromEntries(
      Object.entries(variables ?? {}).map(([key, value]) => [
        key,
        typeof value === 'function' ? value : () => value,
      ]),
    ),
  };
};
