import { isHtmlFile } from '@/components/HtmlPreview';

interface PublishHtmlArtifactSlotsInput {
  available: boolean;
  enabled: boolean;
  isHtml: boolean;
  publicUrl?: string;
}

interface WorkspaceHtmlPackingDetails {
  inlinedPaths: string[];
  missing: string[];
  oversized: string[];
  remotes: string[];
  uploadedPaths: string[];
}

export const getPublishHtmlArtifactSlots = ({
  available,
  enabled,
  isHtml,
  publicUrl,
}: PublishHtmlArtifactSlotsInput) => {
  const visible = available && enabled && isHtml;

  return {
    showLiveBar: visible && Boolean(publicUrl),
    showOverlayTrigger: visible && !publicUrl,
  };
};

export const shouldOfferWorkspaceHtmlPublish = ({
  available,
  enabled,
  isFolder,
  path,
}: {
  available: boolean;
  enabled: boolean;
  isFolder: boolean;
  path: string;
}) => enabled && available && !isFolder && isHtmlFile({ path });

export const hasWorkspaceHtmlPackingDetails = ({
  inlinedPaths,
  missing,
  oversized,
  remotes,
  uploadedPaths,
}: WorkspaceHtmlPackingDetails) =>
  inlinedPaths.length > 0 ||
  uploadedPaths.length > 0 ||
  missing.length > 0 ||
  oversized.length > 0 ||
  remotes.length > 0;
