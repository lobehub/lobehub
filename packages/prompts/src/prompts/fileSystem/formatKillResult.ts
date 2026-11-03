export interface FormatKillResultParams {
  error?: string;
  shellId: string;
  success: boolean;
}

export const formatKillResult = ({ success, shellId, error }: FormatKillResultParams): string => {
  return success ? `Successfully killed shell: ${shellId}` : `Failed to kill shell: ${error}`;
};
