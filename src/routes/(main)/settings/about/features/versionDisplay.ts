interface DisplayVersionParams {
  desktopAppVersion?: string | null;
  webVersion: string;
}

export const getDisplayVersion = ({ desktopAppVersion, webVersion }: DisplayVersionParams) => {
  const normalizedDesktopVersion = desktopAppVersion?.trim();

  return normalizedDesktopVersion || webVersion;
};
