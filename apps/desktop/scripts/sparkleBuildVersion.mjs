// Sparkle's SUStandardVersionComparator truncates CFBundleVersion at the first dash, so
// `2.2.19-canary.1` and `2.2.19-canary.2` compare equal and no update is ever offered.
// Canary builds therefore carry a dash-free build number and keep the semver as
// CFBundleShortVersionString (what app.getVersion() and electron-updater still read).
export const toSparkleBuildVersion = (version) => {
  const match = version.match(/^(\d+\.\d+\.\d+)-canary\.(\d+)$/);
  return match ? `${match[1]}.${match[2]}` : version;
};
