const AVATAR_SIZE = 256;
const FALLBACK_BACKGROUND = '#EBEBEB';
const EMOJI_FONT_RATIO = 0.62;

const avatarCache = new Map<string, Promise<string | undefined>>();

const isImageAvatar = (avatar: string) =>
  avatar.startsWith('http') || avatar.startsWith('data:') || avatar.startsWith('/');

const createCanvas = () => {
  const canvas = document.createElement('canvas');
  canvas.width = AVATAR_SIZE;
  canvas.height = AVATAR_SIZE;
  return { canvas, context: canvas.getContext('2d') };
};

const loadImage = (src: string) =>
  new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.crossOrigin = 'anonymous';
    image.addEventListener('load', () => resolve(image));
    image.addEventListener('error', () => reject(new Error(`failed to load avatar: ${src}`)));
    image.src = src;
  });

const renderImageAvatar = async (avatar: string): Promise<string | undefined> => {
  const image = await loadImage(avatar);
  const { canvas, context } = createCanvas();
  if (!context) return undefined;
  context.drawImage(image, 0, 0, AVATAR_SIZE, AVATAR_SIZE);
  return canvas.toDataURL('image/png');
};

const renderEmojiAvatar = (avatar: string, backgroundColor?: string): string | undefined => {
  const { canvas, context } = createCanvas();
  if (!context) return undefined;
  context.fillStyle = backgroundColor || FALLBACK_BACKGROUND;
  context.fillRect(0, 0, AVATAR_SIZE, AVATAR_SIZE);
  context.font = `${Math.round(AVATAR_SIZE * EMOJI_FONT_RATIO)}px sans-serif`;
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.fillText(avatar, AVATAR_SIZE / 2, AVATAR_SIZE / 2 + AVATAR_SIZE * 0.04);
  return canvas.toDataURL('image/png');
};

export interface NotificationAvatarMeta {
  avatar?: string;
  backgroundColor?: string;
}

export const renderAvatarToDataUrl = (
  cacheKey: string,
  meta: NotificationAvatarMeta,
): Promise<string | undefined> => {
  const { avatar, backgroundColor } = meta;
  if (!avatar || typeof document === 'undefined') return Promise.resolve(undefined);

  const key = [cacheKey, avatar, backgroundColor].join('|');
  const cached = avatarCache.get(key);
  if (cached) return cached;

  const pending = (async () => {
    try {
      return isImageAvatar(avatar)
        ? await renderImageAvatar(avatar)
        : renderEmojiAvatar(avatar, backgroundColor);
    } catch (error) {
      console.error('Notification avatar render failed:', error);
      avatarCache.delete(key);
      return undefined;
    }
  })();

  avatarCache.set(key, pending);
  return pending;
};
