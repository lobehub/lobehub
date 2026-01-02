import { BRANDING_EMAIL, BRANDING_NAME, SOCIAL_URL } from '@lobechat/business-const';
import { isString } from 'es-toolkit/compat';
import qs from 'query-string';
import urlJoin from 'url-join';

import { DEFAULT_LANG } from '@/const/locale';
import { OFFICIAL_SITE, OFFICIAL_URL } from '@/const/url';
import { type Locales } from '@/locales/resources';
import { getCanonicalUrl } from '@/server/utils/url';

import pkg from '../../package.json';

const LAST_MODIFIED = new Date().toISOString();
export const AUTHOR_LIST = {
  arvinxx: {
    avatar: 'https://avatars.githubusercontent.com/u/28616219?v=4',
    desc: 'Founder, Design Engineer',
    name: 'Arvin Xu',
    url: 'https://github.com/arvinxx',
  },
  canisminor: {
    avatar: 'https://avatars.githubusercontent.com/u/17870709?v=4',
    desc: 'Founder, Design Engineer',
    name: 'CanisMinor',
    url: 'https://github.com/canisminor1990',
  },
  lobehub: {
    avatar: 'https://avatars.githubusercontent.com/u/131470832?v=4',
    desc: 'Official Account',
    name: 'LobeHub',
    url: 'https://github.com/lobehub',
  },
};

export class Ld {
  generate({
    image = '/og/cover.png',
    article,
    url,
    title,
    description,
    date,
    locale = DEFAULT_LANG,
    webpage = {
      enable: true,
    },
  }: {
    article?: {
      author: string[];
      enable?: boolean;
      identifier: string;
      tags?: string[];
    };
    date?: string;
    description: string;
    image?: string;
    locale?: Locales;
    title: string;
    url: string;
    webpage?: {
      enable?: boolean;
      search?: boolean | string;
    };
  }) {
    return {
      '@context': 'https://schema.org',
      '@graph': [
        this.genWebSite(),
        article?.enable && this.genArticle({ ...article, date, description, locale, title, url }),
        webpage?.enable &&
          this.genWebPage({
            ...webpage,
            date,
            description,
            image,
            locale,
            title,
            url,
          }),
        image && this.genImageObject({ image, url }),
        this.genOrganization(),
      ].filter(Boolean),
    };
  }

  genOrganization() {
    return {
      '@id': this.getId(OFFICIAL_URL, '#organization'),
      '@type': 'Organization',
      'alternateName': 'LobeHub',
      'contactPoint': {
        '@type': 'ContactPoint',
        'contactType': 'customer support',
        'email': BRANDING_EMAIL.support,
      },
      'description':
        'We are a group of e/acc design-engineers, hoping to provide modern design components and tools for AIGC, and creating a technology-driven forum, fostering knowledge interaction and the exchange of ideas that may culminate in mutual inspiration and collaborative innovation.',
      'email': BRANDING_EMAIL.business,
      'founders': [this.getAuthors(['arvinxx']), this.getAuthors(['canisminor'])],
      'image': urlJoin(OFFICIAL_SITE, '/icon-512x512.png'),
      'logo': {
        '@type': 'ImageObject',
        'height': 512,
        'url': urlJoin(OFFICIAL_SITE, '/icon-512x512.png'),
        'width': 512,
      },
      'name': 'LobeHub',
      'sameAs': [SOCIAL_URL.x, SOCIAL_URL.github, SOCIAL_URL.medium, SOCIAL_URL.youtube],
      'url': OFFICIAL_SITE,
    };
  }

  getAuthors(ids: string[] = []) {
    const defaultAuthor = {
      '@id': this.getId(OFFICIAL_URL, '#organization'),
      '@type': 'Organization',
    };
    if (!ids || ids.length === 0) return defaultAuthor;
    if (ids.length === 1 && ids[0] === 'lobehub') return defaultAuthor;
    const personId = ids.find((id) => id !== 'lobehub');
    if (!personId) return defaultAuthor;
    const person = (AUTHOR_LIST as any)?.[personId];
    if (!person) return defaultAuthor;
    return {
      '@type': 'Person',
      'name': person.name,
      'url': person.url,
    };
  }

  genWebPage({
    date,
    image,
    search,
    description,
    title,
    locale = DEFAULT_LANG,
    url,
  }: {
    breadcrumbs?: { title: string; url: string }[];
    date?: string;
    description: string;
    image?: string;
    locale?: Locales;
    search?: boolean | string;
    title: string;
    url: string;
  }) {
    const fixedUrl = getCanonicalUrl(url);
    const dateCreated = date ? new Date(date).toISOString() : LAST_MODIFIED;
    const dateModified = date ? new Date(date).toISOString() : LAST_MODIFIED;

    const baseInfo: any = {
      '@id': fixedUrl,
      '@type': 'WebPage',
      'about': {
        '@id': this.getId(OFFICIAL_URL, '#organization'),
      },
      'breadcrumbs': {
        '@id': this.getId(fixedUrl, '#breadcrumb'),
      },
      'dateModified': dateModified,
      'datePublished': dateCreated,
      'description': description,
      'image': {
        '@id': this.getId(fixedUrl, '#primaryimage'),
      },
      'inLanguage': locale,
      'isPartOf': {
        '@id': this.getId(OFFICIAL_URL, '#website'),
      },
      'name': this.fixTitle(title),
      'primaryImageOfPage': {
        '@id': this.getId(fixedUrl, '#primaryimage'),
      },
      'thumbnailUrl': image,
    };

    if (search)
      baseInfo.potentialAction = {
        '@type': 'SearchAction',
        'query-input': 'required name=search_term_string',
        'target': qs.stringifyUrl({
          query: { q: '{search_term_string}' },
          url: isString(search) ? getCanonicalUrl(search) : fixedUrl,
        }),
      };

    return baseInfo;
  }

  genImageObject({ image, url }: { image: string; url: string }) {
    const fixedUrl = getCanonicalUrl(url);

    return {
      '@id': this.getId(fixedUrl, '#primaryimage'),
      '@type': 'ImageObject',
      'contentUrl': image,
      'inLanguage': DEFAULT_LANG,
      'url': image,
    };
  }

  genWebSite() {
    const baseInfo: any = {
      '@id': this.getId(OFFICIAL_URL, '#website'),
      '@type': 'WebSite',
      'description': pkg.description,
      'inLanguage': DEFAULT_LANG,
      'name': BRANDING_NAME,
      'publisher': {
        '@id': this.getId(OFFICIAL_URL, '#organization'),
      },
      'url': OFFICIAL_URL,
    };

    return baseInfo;
  }

  genArticle({
    description,
    title,
    url,
    author,
    date,
    locale = DEFAULT_LANG,
    tags,
    identifier,
  }: {
    author: string[];
    date?: string;
    description: string;
    identifier: string;
    locale: Locales;
    tags?: string[];
    title: string;
    url: string;
  }) {
    const fixedUrl = getCanonicalUrl(url);

    const dateCreated = date ? new Date(date).toISOString() : LAST_MODIFIED;

    const dateModified = date ? new Date(date).toISOString() : LAST_MODIFIED;
    const baseInfo: any = {
      '@type': 'Article',
      'author': this.getAuthors(author),
      'creator': author,
      'dateCreated': dateCreated,
      'dateModified': dateModified,
      'datePublished': dateCreated,
      'description': description,
      'headline': this.fixTitle(title),
      'identifier': identifier,
      'image': {
        '@id': this.getId(fixedUrl, '#primaryimage'),
      },
      'inLanguage': locale,
      'keywords': tags?.join(' ') || 'LobeHub LobeChat',
      'mainEntityOfPage': fixedUrl,
      'name': title,
      'publisher': {
        '@id': this.getId(OFFICIAL_URL, '#organization'),
      },
      'url': fixedUrl,
    };

    return {
      ...baseInfo,
    };
  }

  private getId(url: string, id: string) {
    return [url, id].join('/');
  }

  private fixTitle(title: string) {
    return title.includes(BRANDING_NAME) ? title : `${title} · ${BRANDING_NAME}`;
  }
}

export const ldModule = new Ld();
