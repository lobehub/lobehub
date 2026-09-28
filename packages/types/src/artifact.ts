export interface PortalArtifact {
  children?: string;
  id: string;
  identifier?: string;
  language?: string;
  title?: string;
  type?: string;
}

export enum ArtifactType {
  Code = 'application/lobe.artifacts.code',
  Default = 'html',
  Python = 'python',
  React = 'application/lobe.artifacts.react',
}

export interface SharedArtifactData {
  id: string;
  iframeSrc: string;
  title: string | null;
}
