import urlJoin from 'url-join';

const isDev = process.env.NODE_ENV === 'development';

export const OFFICIAL_URL = 'https://app.lobehub.com';
export const OFFICIAL_SITE = 'https://lobehub.com';
export const OFFICIAL_DOMAIN = 'lobehub.com';

export const OG_URL = '/og/og.webp?v=1';

export const GITHUB = 'https://github.com/lobehub/lobe-chat';
export const GITHUB_ISSUES = urlJoin(GITHUB, 'issues/new/choose');
export const CHANGELOG = 'https://lobehub.com/changelog';

export const DOCUMENTS = urlJoin(OFFICIAL_SITE, '/docs');
export const USAGE_DOCUMENTS = urlJoin(DOCUMENTS, '/usage');
export const SELF_HOSTING_DOCUMENTS = urlJoin(DOCUMENTS, '/self-hosting');
export const DATABASE_SELF_HOSTING_URL = urlJoin(SELF_HOSTING_DOCUMENTS, '/server-database');

// use this for the link
export const DOCUMENTS_REFER_URL = `${DOCUMENTS}?utm_source=chat_preview`;

export const WIKI_PLUGIN_GUIDE = urlJoin(USAGE_DOCUMENTS, '/plugins/development');
export const MANUAL_UPGRADE_URL = urlJoin(SELF_HOSTING_DOCUMENTS, '/advanced/upstream-sync');

export const BLOG = urlJoin(OFFICIAL_SITE, 'blog');

export const ABOUT = OFFICIAL_SITE;
export const FEEDBACK = 'https://github.com/lobehub/lobe-chat/issues/new/choose';
export const PRIVACY_URL = urlJoin(OFFICIAL_SITE, '/privacy');
export const TERMS_URL = urlJoin(OFFICIAL_SITE, '/terms');

export const PLUGINS_INDEX_URL = 'https://chat-plugins.lobehub.com';

export const MORE_MODEL_PROVIDER_REQUEST_URL =
  'https://github.com/lobehub/lobe-chat/discussions/6157';

export const MORE_FILE_PREVIEW_REQUEST_URL =
  'https://github.com/lobehub/lobe-chat/discussions/3684';

export const AGENTS_INDEX_GITHUB = 'https://github.com/lobehub/lobe-chat-agents';
export const AGENTS_INDEX_GITHUB_ISSUE = urlJoin(AGENTS_INDEX_GITHUB, 'issues/new');
export const AGENTS_OFFICIAL_URL = 'https://lobehub.com/agent';

export const SESSION_CHAT_URL = (agentId: string, mobile?: boolean) => {
  if (mobile) return `/agent/${agentId}`;
  return `/agent/${agentId}`;
};

export const GROUP_CHAT_URL = (groupId: string) => `/group/${groupId}`;

export const LIBRARY_URL = (id: string) => urlJoin('/resource/library', id);

export const imageUrl = (filename: string) => `/images/${filename}`;

export const LOBE_URL_IMPORT_NAME = 'settings';

export const RELEASES_URL = urlJoin(GITHUB, 'releases');

export const mailTo = (email: string) => `mailto:${email}`;

export const AES_GCM_URL = 'https://datatracker.ietf.org/doc/html/draft-ietf-avt-srtp-aes-gcm-01';
export const BASE_PROVIDER_DOC_URL = 'https://lobehub.com/docs/usage/providers';
export const SITEMAP_BASE_URL = isDev ? '/sitemap.xml/' : 'sitemap';
export const CHANGELOG_URL = urlJoin(OFFICIAL_SITE, 'changelog/versions');

export const DOWNLOAD_URL = {
  android: 'https://play.google.com/store/apps/details?id=com.lobehub.app',
  default: urlJoin(OFFICIAL_SITE, '/downloads'),
  ios: 'https://testflight.apple.com/join/2ZbjX4Qp',
} as const;
