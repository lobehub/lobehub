import type { ReactNode } from 'react';

interface PublishHtmlArtifactButtonProps {
  children?: ReactNode;
  content?: string;
  deviceId?: string;
  filePath?: string;
  sandboxTopicId?: string;
  topicId?: string | null;
  workingDirectory?: string;
}

export const PublishHtmlArtifactProvider = ({ children }: PublishHtmlArtifactButtonProps) =>
  children;

export const PublishHtmlArtifactLiveBar = () => null;

export const PublishHtmlArtifactTrigger = () => null;
