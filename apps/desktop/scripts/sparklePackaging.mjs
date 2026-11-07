const SPARKLE_RELEASE_CHANNELS = new Set(['stable', 'canary', 'beta']);

export const isSparkleReleaseChannel = (channel) =>
  !channel || SPARKLE_RELEASE_CHANNELS.has(channel);

export const resolveSparklePackaging = ({
  channel,
  hasAppleCertificate,
  platform,
  sparklePublicKey,
  updateServerUrl,
}) => {
  const hasSparkleSettings = Boolean(updateServerUrl && sparklePublicKey);
  const sparkleRelease = platform === 'darwin' && isSparkleReleaseChannel(channel);

  if (sparkleRelease && hasAppleCertificate && !hasSparkleSettings) {
    throw new Error('macOS releases require UPDATE_SERVER_URL and SPARKLE_ED_PUBLIC_KEY');
  }

  return { useSparkle: sparkleRelease && hasSparkleSettings };
};
