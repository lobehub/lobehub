export interface FormatWriteResultParams {
  error?: string;
  path: string;
  success: boolean;
}

export const formatWriteResult = ({ success, path, error }: FormatWriteResultParams): string => {
  return success
    ? `Successfully wrote to ${path}`
    : `Failed to write file: ${error || 'Unknown error'}`;
};
