import { serverDB } from '@/database/server';
import { UserService } from '@/server/services/user';

type Params = Promise<{ id: string; image: string }>;

// Mapping of file extensions to content types
const CONTENT_TYPE_MAP: Record<string, string> = {
  avif: 'image/avif',
  bmp: 'image/bmp',
  gif: 'image/gif',
  heic: 'image/heic',
  heif: 'image/heif',
  ico: 'image/x-icon',
  jpeg: 'image/jpeg',
  jpg: 'image/jpg',
  png: 'image/png',
  svg: 'image/svg+xml',
  tif: 'image/tiff',
  tiff: 'image/tiff',
  webp: 'image/webp',
};

// Determine content type based on file extension
function getContentType(filename: string): string {
  const extension = filename.split('.').pop()?.toLowerCase() || '';
  return CONTENT_TYPE_MAP[extension] || 'application/octet-stream';
}

export const GET = async (req: Request, segmentData: { params: Params }) => {
  try {
    const params = await segmentData.params;
    const type = getContentType(params.image);
    const userService = new UserService(serverDB);

    const userAvatar = await userService.getUserAvatar(params.id, params.image);
    if (!userAvatar) {
      return new Response('Avatar not found', {
        status: 404,
      });
    }

    return new Response(userAvatar, {
      headers: {
        'Cache-Control': 'public, max-age=31536000, immutable',
        'Content-Type': type,
      },
      status: 200,
    });
  } catch (error) {
    console.error('Error fetching user avatar:', error);
    return new Response('Internal server error', {
      status: 500,
    });
  }
};
