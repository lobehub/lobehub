import SiMastodon from '@icons-pack/react-simple-icons/icons/SiMastodon';
import SiReddit from '@icons-pack/react-simple-icons/icons/SiReddit';
import SiTelegram from '@icons-pack/react-simple-icons/icons/SiTelegram';
import SiWhatsapp from '@icons-pack/react-simple-icons/icons/SiWhatsapp';
import { camelCase, identity, pickBy } from 'es-toolkit/compat';
import qs from 'query-string';

const stringifyHashtags = (hashtags: string[], joinfix: string = ',', prefix?: string) => {
  if (prefix) hashtags = hashtags.map((tag) => prefix + camelCase(tag));
  return hashtags.filter(Boolean).join(joinfix);
};

/**
 * Share links for the channels outside the four-channel `SocialShare`
 * (Reddit, Telegram, WhatsApp, Mastodon). X and Weibo live in
 * `@/features/SocialShare` so every entry posts the same copy.
 */
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
      url: 'https://t.me/share/url',
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
    whatsapp: {
      icon: SiWhatsapp,
      link: genWhatsappLink(),
      title: 'WhatsApp',
    },
  };
};
