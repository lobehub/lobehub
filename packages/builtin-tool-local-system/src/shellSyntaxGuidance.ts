/**
 * Per-shell syntax guidance for the `{{shellSyntaxGuidance}}` placeholder in
 * the local-system system role, so the model only ever sees instructions for
 * the shell `runCommand` actually spawns. The previous prompt always carried
 * the PowerShell 5.1 guidance, which anchored models into emitting PowerShell
 * commands even when the user had selected Git Bash (LOBE-12692).
 *
 * Matching is by the human-readable shell names produced by `getShellInfo()`
 * in `@lobechat/local-file-shell` ("Git Bash", "PowerShell 7+ (pwsh)",
 * "Windows PowerShell 5.1", "cmd.exe", "/bin/sh") — that display name is what
 * both the renderer context and the device system-info report carry. Keep the
 * two in sync when adding a shell.
 */
export const getShellSyntaxGuidance = (defaultShell?: string): string => {
  const shell = defaultShell?.toLowerCase() ?? '';

  if (shell.includes('git bash') || shell.includes('gitbash'))
    return 'Write POSIX/bash syntax (&&, ||, $VAR); do NOT use PowerShell or cmd.exe syntax.';

  // "Windows PowerShell 5.1" must be checked before the generic PowerShell
  // match — it is the only edition without the && / || chain operators.
  if (shell.includes('powershell 5'))
    return "Write Windows PowerShell 5.1-compatible syntax; the &&/|| chain operators are NOT available — use ';' to sequence commands or 'if ($?) { ... }' for conditional chaining.";

  if (shell.includes('pwsh') || shell.includes('powershell'))
    return 'Write PowerShell syntax; the && and || chain operators are available.';

  if (shell.includes('cmd'))
    return 'Write cmd.exe syntax (&& to chain, %VAR% for environment variables); do NOT use PowerShell-only syntax.';

  // `/bin/…` covers sh/zsh/fish paths; a bare "sh" substring would also match
  // unrelated words like "shell", so match the path form and named shells only.
  if (shell.includes('/bin/') || shell.includes('bash') || shell.includes('zsh'))
    return 'Write POSIX shell syntax.';

  // Unknown shell (e.g. an older client that reports nothing): keep the old
  // conditional wording rather than guessing a concrete shell.
  return "When that shell is PowerShell, write PowerShell-compatible syntax; on Windows PowerShell 5.1 the &&/|| chain operators are NOT available — use ';' to sequence commands or 'if ($?) { ... }' for conditional chaining.";
};
