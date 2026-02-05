import Image from '@/libs/next/Image';

interface WebFaviconProps {
  alt?: string;
  size?: number;
  title?: string;
  url: string;
}

const WebFavicon = ({ url, title, alt, size = 14 }: WebFaviconProps) => {
  const urlObj = new URL(url);
  const host = urlObj.hostname;

  return (
    <Image
      unoptimized
      alt={alt || title || url}
      height={size}
      src={`https://icons.duckduckgo.com/ip3/${host}.ico`}
      style={{ borderRadius: 4 }}
      width={size}
    />
  );
};

export default WebFavicon;
