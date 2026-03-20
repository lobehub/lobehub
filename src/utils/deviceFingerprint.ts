/**
 * Lightweight device fingerprint for referral anti-abuse.
 *
 * Collects a set of stable browser properties, concatenates them,
 * and produces a SHA-256 hex digest.
 */

const getCanvasFingerprint = (): string => {
  try {
    const canvas = document.createElement('canvas');
    canvas.width = 200;
    canvas.height = 50;
    const ctx = canvas.getContext('2d');
    if (!ctx) return '';
    ctx.textBaseline = 'top';
    ctx.font = '14px Arial';
    ctx.fillStyle = '#f60';
    ctx.fillRect(40, 0, 62, 20);
    ctx.fillStyle = '#069';
    ctx.fillText('LobeHub fp', 2, 15);
    ctx.fillStyle = 'rgba(102,204,0,0.7)';
    ctx.fillText('LobeHub fp', 4, 17);
    return canvas.toDataURL();
  } catch {
    return '';
  }
};

const getWebGLInfo = (): string => {
  try {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
    if (!gl || !(gl instanceof WebGLRenderingContext)) return '';
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    if (!ext) return '';
    const vendor = gl.getParameter(ext.UNMASKED_VENDOR_WEBGL) as string;
    const renderer = gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) as string;
    return `${vendor}~${renderer}`;
  } catch {
    return '';
  }
};

const collectRawSignals = (): string => {
  if (typeof window === 'undefined') return '';

  const parts: string[] = [
    getCanvasFingerprint(),
    getWebGLInfo(),
    `${screen.width}x${screen.height}x${devicePixelRatio}`,
    Intl.DateTimeFormat().resolvedOptions().timeZone,
    navigator.language,
    navigator.platform,
  ];

  return parts.join('|');
};

/** Simple DJB2 hash as fallback when crypto.subtle is unavailable (e.g. non-HTTPS) */
const djb2Hex = (input: string): string => {
  let hash = 5381;
  for (let i = 0; i < input.length; i++) {
    hash = ((hash << 5) + hash + input.charCodeAt(i)) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
};

const hashString = async (input: string): Promise<string> => {
  try {
    const data = new TextEncoder().encode(input);
    const hash = await crypto.subtle.digest('SHA-256', data);
    return Array.from(new Uint8Array(hash))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
  } catch {
    return djb2Hex(input);
  }
};

export const getDeviceFingerprint = async (): Promise<string> => {
  const raw = collectRawSignals();
  return hashString(raw);
};
