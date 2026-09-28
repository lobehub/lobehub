import { browserless } from './browserless';
import { crw } from './crw';
import { exa } from './exa';
import { firecrawl } from './firecrawl';
import { jina } from './jina';
import { naive } from './naive';
import { search1api } from './search1api';
import { tavily } from './tavily';

export const crawlImpls = {
  browserless,
  crw,
  exa,
  firecrawl,
  jina,
  naive,
  search1api,
  tavily,
};

export type CrawlImplType = keyof typeof crawlImpls;
