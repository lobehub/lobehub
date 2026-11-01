import { resolveAuthLocale } from '../lib/locale';
import { buildAuthMeta } from '../lib/seo';

export const meta = () => buildAuthMeta(resolveAuthLocale(), '/market-auth-callback');

export { default } from '@/features/Auth/MarketAuthCallback';
