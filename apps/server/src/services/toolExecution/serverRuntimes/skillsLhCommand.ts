import {
  isLhCommand,
  preprocessLhCommand,
} from '@/server/services/toolExecution/preprocessLhCommand';

/**
 * Rewrite an `lh` command for sandbox execution: prepend the auth +
 * workspace-scope prelude so the CLI runs as this user, against this run's
 * workspace. Shared by `runCommand` and `execScript` — the model picks
 * between them by manifest wording alone (`execScript` is the one described
 * as "run the CLI commands a skill's instructions tell you to"), so a hole in
 * either one is a hole in the whole `lh` surface.
 */
export const preprocessSkillSandboxCommand = async (
  command: string,
  scope: {
    /** The run's sender may not use devices; see `preprocessLhCommand`. */
    deviceAccessDenied: boolean;
    operationId?: string;
    resolveWorkspaceId: () => Promise<string | undefined>;
    /**
     * `lobe-skills` IS reachable in an Agent Share visitor's run (only its two
     * load APIs are), so this runtime does get constructed for one: `userId` is
     * the CREATOR, and minting an `lh` token from it inside a shell a visitor
     * influenced would hand over the creator's whole CLI surface. Nothing routes
     * here today — the gate strips `runCommand` / `execScript` before dispatch —
     * so this is the backstop for the day Agent Share grows an approval step.
     */
    shareVisitorBlocked: boolean;
    userId: string;
    workspaceId?: string;
  },
): Promise<{ command: string; error?: string }> => {
  const workspaceId =
    scope.workspaceId ?? (isLhCommand(command) ? await scope.resolveWorkspaceId() : undefined);
  const result = await preprocessLhCommand(
    command,
    scope.userId,
    workspaceId,
    scope.shareVisitorBlocked,
    scope.operationId,
    scope.deviceAccessDenied,
  );

  return { command: result.command, error: result.error };
};
