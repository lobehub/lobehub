import { AnspireImpl } from './anspire';
import { BochaImpl } from './bocha';
import { BraveImpl } from './brave';
import { ExaImpl } from './exa';
import { FirecrawlImpl } from './firecrawl';
import { GoogleImpl } from './google';
import { JinaImpl } from './jina';
import { KagiImpl } from './kagi';
import { Search1APIImpl } from './search1api';
import { SearXNGImpl } from './searxng';
import { TavilyImpl } from './tavily';
import { type SearchServiceImpl } from './type';

/**
 * Available search service implementations
 */
export enum SearchImplType {
  Anspire = 'anspire',
  Bocha = 'bocha',
  Brave = 'brave',
  Exa = 'exa',
  Firecrawl = 'firecrawl',
  Google = 'google',
  Jina = 'jina',
  Kagi = 'kagi',
  Search1API = 'search1api',
  SearXNG = 'searxng',
  Tavily = 'tavily',
}

/**
 * Create a search service implementation instance
 */
export const createSearchServiceImpl = (
  type: SearchImplType = SearchImplType.SearXNG,
): SearchServiceImpl => {
  switch (type) {
    case SearchImplType.Anspire: {
      return new AnspireImpl();
    }

    case SearchImplType.Bocha: {
      return new BochaImpl();
    }

    case SearchImplType.Brave: {
      return new BraveImpl();
    }

    case SearchImplType.Exa: {
      return new ExaImpl();
    }

    case SearchImplType.Firecrawl: {
      return new FirecrawlImpl();
    }

    case SearchImplType.Google: {
      return new GoogleImpl();
    }

    case SearchImplType.Jina: {
      return new JinaImpl();
    }

    case SearchImplType.Kagi: {
      return new KagiImpl();
    }

    case SearchImplType.SearXNG: {
      return new SearXNGImpl();
    }

    case SearchImplType.Tavily: {
      return new TavilyImpl();
    }

    default: {
      return new Search1APIImpl();
    }
  }
};

export type { SearchServiceImpl } from './type';
