// A markdown link's click handler opens the same href the rendered <a href> already
// points at, in a new tab with noopener. That is an ordinary link click.
import type { MouseEvent } from 'react';
import { useCallback } from 'react';

interface FileLinkProps {
  fileId?: string;
  linkHref?: string;
  onPreview: (fileId: string) => void;
  openInNewTab: boolean;
}

const FileLink = ({ fileId, linkHref, onPreview, openInNewTab }: FileLinkProps) => {
  const handleClick = useCallback(
    (event: MouseEvent<HTMLAnchorElement>) => {
      if (!fileId || event.button !== 0) return;
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;

      event.preventDefault();
      if (openInNewTab && linkHref) {
        window.open(linkHref, '_blank', 'noopener,noreferrer');
        return;
      }
      onPreview(fileId);
    },
    [fileId, linkHref, onPreview, openInNewTab],
  );

  return (
    <a href={linkHref} rel="noopener noreferrer" onClick={handleClick}>
      {linkHref}
    </a>
  );
};

export default FileLink;
