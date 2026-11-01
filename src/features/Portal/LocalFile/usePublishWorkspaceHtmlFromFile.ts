interface UsePublishWorkspaceHtmlFromFileInput {
  deviceId?: string;
  workingDirectory: string;
}

export const usePublishWorkspaceHtmlFromFile = (_input: UsePublishWorkspaceHtmlFromFileInput) => ({
  canOfferFile: (_path: string, _isFolder: boolean) => false,
  publishFile: async (_filePath: string) => {},
});
