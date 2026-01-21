export interface FormatRenameResultParams {
  error?: string;
  newName: string;
  oldPath: string;
  success: boolean;
}

export const formatRenameResult = ({
  success,
  oldPath,
  newName,
  error,
}: FormatRenameResultParams): string => {
  return success
    ? `Successfully renamed file ${oldPath} to ${newName}`
    : `Failed to rename file: ${error}`;
};
