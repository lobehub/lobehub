export const artifactSharePath = (deploymentId: string) => `/share/artifact/${deploymentId}`;

export const artifactShareUrl = (origin: string, deploymentId: string) =>
  `${origin.replace(/\/+$/, '')}${artifactSharePath(deploymentId)}`;
