import { comfyUICreateImageAPIHandler } from '@/server/api-runtime/createImage';
import { createNextAPIRouteHandler } from '@/server/api-runtime/next';

export const maxDuration = 300;

export const POST = createNextAPIRouteHandler(
  'webapi-create-image-comfyui',
  comfyUICreateImageAPIHandler,
  { honoRuntime: 'root' },
);
