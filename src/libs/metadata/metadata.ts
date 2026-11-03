import { BRANDING_NAME, ORG_NAME } from '@lobechat/business-const';
import { type Metadata } from 'next';
import qs from 'query-string';

import { DEFAULT_LANG } from '@/const/locale';
import { OG_URL } from '@/const/url';
import { isCustomORG } from '@/const/version';
import { type Locales } from '@/locales/resources';
import { locales } from '@/locales/resources';
import { getCanonicalUrl } from '@/server/utils/url';
import { formatDescLength, formatTitleLength } from '@/utils/genOG';

export class Meta {
  public generate({
    description = 'LobeChat offers you the best ChatGPT, OLLaMA, Gemini, Claude WebUI user experience',
    title,
    image = OG_URL,
    url,
    type = 'website',
    tags,
    alternate,
    locale = DEFAULT_LANG,
    canonical,
  }: {
    alternate?: boolean;
    canonical?: string;
    description?: string;
    image?: string;
    locale?: Locales;
    tags?: string[];
    title: string;
    type?: 'website' | 'article';
    url: string;
  }): Metadata {
    const formatedTitle = formatTitleLength(title, 21);

    const formatedDescription = formatDescLength(description, tags);
    const siteTitle = title.includes(BRANDING_NAME) ? title : title + ` · ${BRANDING_NAME}`;
    return {
      alternates: {
        canonical:
          canonical ||
          getCanonicalUrl(alternate ? qs.stringifyUrl({ query: { hl: locale }, url }) : url),
        languages: alternate ? this.genAlternateLocales(locale, url) : undefined,
      },
      description: formatedDescription,
      openGraph: this.genOpenGraph({
        alternate,
        description,
        image,
        locale,
        title: siteTitle,
        type,
        url,
      }),
      other: {
        robots: 'index,follow',
      },
      title: formatedTitle,
      twitter: this.genTwitter({ description, image, title: siteTitle, url }),
    };
  }

  private genAlternateLocales = (locale: Locales, path: string = '/') => {
    const links: any = {};
    const defaultLink = getCanonicalUrl(path);
    for (const alterLocales of locales) {
      links[alterLocales] = qs.stringifyUrl({
        query: { hl: alterLocales },
        url: defaultLink,
      });
    }
    return {
      'x-default': defaultLink,
      ...links,
    };
  };

  private genTwitter({
    description,
    title,
    image,
    url,
  }: {
    description: string;
    image: string;
    title: string;
    url: string;
  }) {
    return {
      card: 'summary_large_image',
      description,
      images: [image],
      site: isCustomORG ? `@${ORG_NAME}` : '@lobehub',
      title,
      url,
    };
  }

  private genOpenGraph({
    alternate,
    locale = DEFAULT_LANG,
    description,
    title,
    image,
    url,
    type = 'website',
  }: {
    alternate?: boolean;
    description: string;
    image: string;
    locale: Locales;
    title: string;
    type?: 'website' | 'article';
    url: string;
  }) {
    const data: any = {
      description,
      images: [
        {
          alt: title,
          url: image,
        },
      ],
      locale,
      siteName: BRANDING_NAME,
      title,
      type,
      url,
    };

    if (alternate) {
      data['alternateLocale'] = locales;
    }

    return data;
  }
}

export const metadataModule = new Meta();
