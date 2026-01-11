import { memo, useEffect, useRef, useState } from 'react';

interface TruncatedFileNameProps {
  className?: string;
  name: string;
}

/**
 * Truncates file name from the center, preserving the extension at the end
 * Similar to macOS Finder behavior
 */
const TruncatedFileName = memo<TruncatedFileNameProps>(({ name, className }) => {
  const containerRef = useRef<HTMLSpanElement>(null);
  const [displayName, setDisplayName] = useState(name);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const updateTruncation = () => {
      const containerWidth = container.offsetWidth;
      if (containerWidth === 0) return;

      // Create a temporary span to measure text width
      const measureSpan = document.createElement('span');
      measureSpan.style.visibility = 'hidden';
      measureSpan.style.position = 'absolute';
      measureSpan.style.whiteSpace = 'nowrap';
      measureSpan.style.font = window.getComputedStyle(container).font;
      document.body.appendChild(measureSpan);

      // Measure full name
      measureSpan.textContent = name;
      const fullWidth = measureSpan.offsetWidth;

      // If it fits, show the full name
      if (fullWidth <= containerWidth) {
        setDisplayName(name);
        document.body.removeChild(measureSpan);
        return;
      }

      // Split filename and extension
      const lastDotIndex = name.lastIndexOf('.');
      let baseName = name;
      let extension = '';

      // Only treat as extension if dot is not at the start and there's content after it
      if (lastDotIndex > 0 && lastDotIndex < name.length - 1) {
        baseName = name.slice(0, lastDotIndex);
        extension = name.slice(lastDotIndex); // includes the dot
      }

      // Measure ellipsis width
      measureSpan.textContent = '...';
      const ellipsisWidth = measureSpan.offsetWidth;

      // Measure extension width
      measureSpan.textContent = extension;
      const extensionWidth = measureSpan.offsetWidth;

      // Calculate available width for base name
      const availableWidth = containerWidth - ellipsisWidth - extensionWidth;

      if (availableWidth <= 0) {
        // Not enough space, just show ellipsis + extension
        setDisplayName(`...${extension}`);
        document.body.removeChild(measureSpan);
        return;
      }

      // Binary search to find the optimal split point
      let left = 0;
      let right = baseName.length;
      let bestFit = '';

      while (left <= right) {
        const mid = Math.floor((left + right) / 2);
        const startChars = Math.ceil(mid / 2);
        const endChars = Math.floor(mid / 2);

        const truncated =
          baseName.slice(0, startChars) + (mid > 0 ? baseName.slice(-endChars) : '');

        measureSpan.textContent = truncated;
        const truncatedWidth = measureSpan.offsetWidth;

        if (truncatedWidth <= availableWidth) {
          bestFit = truncated;
          left = mid + 1;
        } else {
          right = mid - 1;
        }
      }

      document.body.removeChild(measureSpan);

      // Construct final truncated name
      if (bestFit.length === 0) {
        setDisplayName(`...${extension}`);
      } else {
        const startChars = Math.ceil(bestFit.length / 2);
        const endChars = Math.floor(bestFit.length / 2);
        setDisplayName(`${baseName.slice(0, startChars)}...${baseName.slice(-endChars)}${extension}`);
      }
    };

    updateTruncation();

    // Use ResizeObserver to handle container size changes
    const resizeObserver = new ResizeObserver(updateTruncation);
    resizeObserver.observe(container);

    return () => {
      resizeObserver.disconnect();
    };
  }, [name]);

  return (
    <span className={className} ref={containerRef} title={name}>
      {displayName}
    </span>
  );
});

TruncatedFileName.displayName = 'TruncatedFileName';

export default TruncatedFileName;
