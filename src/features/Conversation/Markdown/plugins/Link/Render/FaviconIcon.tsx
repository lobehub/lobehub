import { Globe } from 'lucide-react';
import { memo, useState } from 'react';

interface FaviconIconProps {
  domain: string;
  size?: number;
}

/**
 * Inline site favicon for generic external links. Falls back to a globe glyph
 * when the favicon cannot be loaded.
 */
const FaviconIcon = memo<FaviconIconProps>(({ domain, size = 15 }) => {
  const [failed, setFailed] = useState(false);

  if (failed) return <Globe size={size} />;

  return (
    <img
      alt=""
      height={size}
      src={`https://icons.duckduckgo.com/ip3/${domain}.ico`}
      style={{ borderRadius: 3, objectFit: 'contain' }}
      width={size}
      onError={() => setFailed(true)}
    />
  );
});

FaviconIcon.displayName = 'FaviconIcon';

export default FaviconIcon;
