const AVATAR_SIZE = 256;
const FALLBACK_BACKGROUND = '#EBEBEB';
const EMOJI_FONT_RATIO = 0.62;

export const NOTIFICATION_AVATAR_LOAD_TIMEOUT_MS = 2000;
export const NOTIFICATION_AVATAR_CACHE_LIMIT = 32;

const avatarCache = new Map<string, Promise<string | undefined>>();

const isImageAvatar = (avatar: string) =>
  avatar.startsWith('http') || avatar.startsWith('data:') || avatar.startsWith('/');

const rememberAvatar = (key: string, value: Promise<string | undefined>) => {
  if (avatarCache.has(key)) {
    avatarCache.delete(key);
  } else if (avatarCache.size >= NOTIFICATION_AVATAR_CACHE_LIMIT) {
    const oldest = avatarCache.keys().next().value;
    if (oldest !== undefined) avatarCache.delete(oldest);
  }
  avatarCache.set(key, value);
};

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
    let settled = false;

    const finish = (action: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      action();
    };

    const timer = setTimeout(() => {
      finish(() => {
        image.src = '';
        reject(new Error(`avatar load timed out: ${src}`));
      });
    }, NOTIFICATION_AVATAR_LOAD_TIMEOUT_MS);

    image.addEventListener('load', () => finish(() => resolve(image)));
    image.addEventListener('error', () =>
      finish(() => reject(new Error(`failed to load avatar: ${src}`))),
    );
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
  if (cached) {
    rememberAvatar(key, cached);
    return cached;
  }

  const work = (async () => {
    return isImageAvatar(avatar)
      ? await renderImageAvatar(avatar)
      : renderEmojiAvatar(avatar, backgroundColor);
  })();

  const pending = work.catch((error: unknown) => {
    console.error('Notification avatar render failed:', error);
    return undefined;
  });

  void work.catch(() => {
    if (avatarCache.get(key) === pending) avatarCache.delete(key);
  });

  rememberAvatar(key, pending);
  return pending;
};
