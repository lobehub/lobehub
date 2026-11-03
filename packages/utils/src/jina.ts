const DEFAULT_JINA_READER_BASE_URL = 'https://r.jina.ai';
const DEFAULT_JINA_SEARCH_BASE_URL = 'https://s.jina.ai';
const CN_JINA_READER_BASE_URL = 'https://r.jinaai.cn';
const CN_JINA_SEARCH_BASE_URL = 'https://s.jinaai.cn';

export const isJinaCnDomainsEnabled = () =>
  process.env.JINA_USE_CN_DOMAINS?.trim().toLowerCase() === 'true';

export const getJinaReaderBaseUrl = () =>
  isJinaCnDomainsEnabled() ? CN_JINA_READER_BASE_URL : DEFAULT_JINA_READER_BASE_URL;

export const getJinaSearchBaseUrl = () =>
  isJinaCnDomainsEnabled() ? CN_JINA_SEARCH_BASE_URL : DEFAULT_JINA_SEARCH_BASE_URL;
