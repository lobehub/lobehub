import urlJoin from 'url-join';

const isDev = process.env.NODE_ENV === 'development';

export const OFFICIAL_URL = 'https://picturaai.sbs';
export const OFFICIAL_SITE = 'https://picturaai.sbs';
export const OFFICIAL_DOMAIN = 'picturaai.sbs';

export const OG_URL = '/og/og.webp?v=1';

export const GITHUB = undefined;
export const GITHUB_ISSUES = undefined;
export const CHANGELOG = 'https://picturaai.sbs/changelog';

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
export const FEEDBACK = undefined;
export const PRIVACY_URL = urlJoin(OFFICIAL_SITE, '/privacy');
export const TERMS_URL = urlJoin(OFFICIAL_SITE, '/terms');

export const PLUGINS_INDEX_URL = 'https://chat-plugins.lobehub.com';

export const MORE_MODEL_PROVIDER_REQUEST_URL = undefined;

export const MORE_FILE_PREVIEW_REQUEST_URL = undefined;

export const AGENTS_INDEX_GITHUB = undefined;
export const AGENTS_INDEX_GITHUB_ISSUE = undefined;
export const AGENTS_OFFICIAL_URL = 'https://picturaai.sbs/agent';

export const SESSION_CHAT_URL = (agentId: string, mobile?: boolean) => {
  if (mobile) return `/agent/${agentId}`;
  return `/agent/${agentId}`;
};

export const AGENT_PROFILE_URL = (agentId: string) => `/agent/${agentId}/profile`;

export const GROUP_CHAT_URL = (groupId: string) => `/group/${groupId}`;

export const LIBRARY_URL = (id: string) => urlJoin('/resource/library', id);

export const imageUrl = (filename: string) => `/images/${filename}`;

export const LOBE_URL_IMPORT_NAME = 'settings';

export const RELEASES_URL = undefined;

export const mailTo = (email: string) => `mailto:${email}`;

export const AES_GCM_URL = 'https://datatracker.ietf.org/doc/html/draft-ietf-avt-srtp-aes-gcm-01';
export const BASE_PROVIDER_DOC_URL = 'https://picturaai.sbs/docs/usage/providers';
export const SITEMAP_BASE_URL = isDev ? '/sitemap.xml/' : 'sitemap';
export const CHANGELOG_URL = urlJoin(OFFICIAL_SITE, 'changelog/versions');

export const DOWNLOAD_URL = {
  android: undefined,
  default: undefined,
  ios: undefined,
} as const;
