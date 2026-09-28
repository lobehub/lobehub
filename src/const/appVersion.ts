import { CURRENT_VERSION } from '@/const/version';

// Cloud injects the release version at build time; other Web builds use package metadata.
export const WEB_APP_VERSION = process.env.NEXT_PUBLIC_APP_VERSION || CURRENT_VERSION;
