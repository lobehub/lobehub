import { resolveAuthLocale } from '../lib/locale';
import { buildAuthMeta } from '../lib/seo';

export const meta = () => buildAuthMeta(resolveAuthLocale(), '/oauth/device/confirm');

export { default } from '@/features/Auth/OAuthDevice/DeviceConfirmPage';
