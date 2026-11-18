import type { ArtboardDeploymentSource } from '@lobechat/types';
import * as stylex from '@stylexjs/stylex';
import { memo } from 'react';

import { useArtifactDeploymentPreviewUrl } from '@/business/client/hooks/useArtifactDeploymentPreviewUrl';

const styles = stylex.create({
  frame: {
    backgroundColor: 'transparent',
    borderWidth: 0,
    flex: '1',
    minHeight: 0,
    width: '100%',
  },
});

interface DeploymentFrameProps {
  source: ArtboardDeploymentSource;
  title: string;
}

/**
 * One pinned release of a hosted HTML deployment. The page is served from the
 * app's own origin, so the sandbox must never grant `allow-same-origin`.
 */
const DeploymentFrame = memo<DeploymentFrameProps>(({ source, title }) => {
  const url = useArtifactDeploymentPreviewUrl(source);
  // Only a build that hosts no deployments lacks a URL, and it cannot pin a board to one.
  if (!url) return null;

  return (
    <iframe
      {...stylex.props(styles.frame)}
      referrerPolicy="no-referrer"
      sandbox="allow-scripts allow-popups allow-forms"
      src={url}
      title={title}
    />
  );
});

DeploymentFrame.displayName = 'ArtboardDeploymentFrame';

export default DeploymentFrame;
