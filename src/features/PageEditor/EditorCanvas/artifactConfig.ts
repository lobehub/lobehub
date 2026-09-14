import type { ArtifactLabels } from '@lobehub/editor';

/** Page artifacts are interactive apps, while ArtifactPreview keeps an opaque sandbox. */
export const createPageArtifactPluginProps = (labels: ArtifactLabels) => ({
  allowScripts: true,
  labels,
});
