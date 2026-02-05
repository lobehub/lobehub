import {
  SiMastodon,
  SiReddit,
  SiSinaweibo,
  SiTelegram,
  SiWhatsapp,
  SiX,
} from '@icons-pack/react-simple-icons';
import { camelCase, identity, pickBy } from 'es-toolkit/compat';
import qs from 'query-string';

const stringifyHashtags = (hashtags: string[], joinfix: string = ',', prefix?: string) => {
   
  if (prefix) hashtags = hashtags.map((tag) => prefix + camelCase(tag));
  return hashtags.filter(Boolean).join(joinfix);
};

export const useShare = ({
  url,
  title,
  desc,
  hashtags = [],
}: {
  desc: string;
  hashtags?: string[];
  title: string;
  url: string;
}) => {
  const genRedditLink = () => {
    const query = pickBy(
      {
        title: [
          [title, desc].filter(Boolean).join(' - '),
          hashtags && stringifyHashtags(hashtags, ' ', '#'),
        ]
          .filter(Boolean)
          .join(' '),
        url,
      },
      identity,
    ) as any;
    return qs.stringifyUrl({
      query,
      url: 'https://www.reddit.com/submit',
    });
  };

  const genTelegramLink = () => {
    const query = pickBy(
      {
        text: [
          [title, desc].filter(Boolean).join(' - '),
          hashtags && stringifyHashtags(hashtags, ' ', '#'),
        ]
          .filter(Boolean)
          .join(' '),
        url,
      },
      identity,
    ) as any;
    return qs.stringifyUrl({
      query,
      url: 'https://t.me/share/url"',
    });
  };

  const genWeiboLink = () => {
    const query = pickBy(
      {
        sharesource: 'weibo',
        title: [
          [title, desc].filter(Boolean).join(' - '),
          hashtags && stringifyHashtags(hashtags, ' ', '#'),
        ]
          .filter(Boolean)
          .join(' '),
        url,
      },
      identity,
    ) as any;
    return qs.stringifyUrl({
      query,
      url: 'http://service.weibo.com/share/share.php',
    });
  };

  const genWhatsappLink = () => {
    const query = pickBy(
      {
        text: [
          [title, desc].filter(Boolean).join(' - '),
          url,
          hashtags && stringifyHashtags(hashtags, ' ', '#'),
        ]
          .filter(Boolean)
          .join(' '),
      },
      identity,
    ) as any;
    return qs.stringifyUrl({
      query,
      url: 'https://api.whatsapp.com/send',
    });
  };

  const genXLink = () => {
    const query = pickBy(
      {
        hashtags: hashtags && stringifyHashtags(hashtags),
        text: [title, desc].filter(Boolean).join(' - '),
        url,
      },
      identity,
    ) as any;
    return qs.stringifyUrl({
      query,
      url: 'https://x.com/intent/tweet',
    });
  };

  const genLinkdinLink = () => {
    const query = pickBy(
      {
        url,
      },
      identity,
    ) as any;
    return qs.stringifyUrl({
      query,
      url: 'https://www.linkedin.com/sharing/share-offsite/',
    });
  };

  const genMastodonLink = () => {
    const query = pickBy(
      {
        text: [
          [title, desc].filter(Boolean).join(' - '),

          hashtags && stringifyHashtags(hashtags, ' ', '#'),
        ]
          .filter(Boolean)
          .join(' '),
        url,
      },
      identity,
    ) as any;
    return qs.stringifyUrl({
      query,
      url: 'https://mastodon.social/share',
    });
  };

  return {
    linkedin: {
      link: genLinkdinLink(),
      title: 'Linkedin',
    },
    mastodon: {
      icon: SiMastodon,
      link: genMastodonLink(),
      title: 'Mastodon',
    },
    reddit: {
      icon: SiReddit,
      link: genRedditLink(),
      title: 'Reddit',
    },
    telegram: {
      icon: SiTelegram,
      link: genTelegramLink(),
      title: 'Telegram',
    },
    weibo: {
      icon: SiSinaweibo,
      link: genWeiboLink(),
      title: 'Weibo',
    },
    whatsapp: {
      icon: SiWhatsapp,
      link: genWhatsappLink(),
      title: 'WhatsApp',
    },
    x: {
      icon: SiX,
      link: genXLink(),
      title: 'X',
    },
  };
};
