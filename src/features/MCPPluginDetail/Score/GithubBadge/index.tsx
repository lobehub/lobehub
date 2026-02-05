import { Markdown, Select, Snippet, Tag } from '@lobehub/ui';
import { Divider } from 'antd';
import { cssVar } from 'antd-style';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import urlJoin from 'url-join';

import { OFFICIAL_SITE } from '@/const/url';

import { useDetailContext } from '../../DetailProvider';

type BadgeStyle = 'flat' | 'flat-square' | 'plastic' | 'for-the-badge';
type BadgeTheme = 'dark' | 'light';

const GithubBadge = memo(() => {
  const { t } = useTranslation('discover');
  const { identifier = '' } = useDetailContext();
  const [selectedStyle, setSelectedStyle] = useState<BadgeStyle>('flat-square');
  const [selectedTheme, setSelectedTheme] = useState<BadgeTheme>('dark');

  const pageUrl = urlJoin(OFFICIAL_SITE, 'mcp', identifier);
  const badgeUrl = urlJoin(OFFICIAL_SITE, 'badge/mcp', identifier);
  const styledBadgeUrl =
    selectedStyle === 'flat-square' ? badgeUrl : `${badgeUrl}?style=${selectedStyle}`;

  const badgeFullUrl = urlJoin(OFFICIAL_SITE, 'badge/mcp-full', identifier);

  // 构建带主题参数的完整 badge URL
  const styledBadgeFullUrl =
    selectedTheme === 'dark' ? badgeFullUrl : `${badgeFullUrl}?theme=${selectedTheme}`;

  const badgeLite = `[![MCP Badge](${styledBadgeUrl})](${pageUrl})`;

  const badge = `[![MCP Badge](${styledBadgeFullUrl})](${pageUrl})`;

  const styleOptions = [
    { label: 'Flat Square', value: 'flat-square' },
    { label: 'Flat', value: 'flat' },
    { label: 'Plastic', value: 'plastic' },
    { label: 'For The Badge', value: 'for-the-badge' },
  ];

  const themeOptions = [
    { label: 'Dark', value: 'dark' },
    { label: 'Light', value: 'light' },
  ];

  return (
    <>
      <Markdown>{t('mcp.details.githubBadge.desc')}</Markdown>

      <Select
        options={styleOptions}
        prefix={<Tag style={{ marginRight: 4 }}>style</Tag>}
        value={selectedStyle}
        onChange={setSelectedStyle}
      />
      <Snippet language={'md'} style={{ fontSize: 12 }} variant={'outlined'}>
        {badgeLite}
      </Snippet>
      { }
      <img
        alt="MCP Badge"
        height={selectedStyle === 'for-the-badge' ? 28 : 20}
        src={styledBadgeUrl}
      />
      <Divider style={{ color: cssVar.colorTextDescription, fontSize: 12 }}>OR</Divider>
      <Select
        options={themeOptions}
        prefix={<Tag style={{ marginRight: 4 }}>theme</Tag>}
        value={selectedTheme}
        onChange={setSelectedTheme}
      />
      <Snippet language={'md'} style={{ fontSize: 12 }} variant={'outlined'}>
        {badge}
      </Snippet>
      { }
      <img alt="MCP Badge" src={styledBadgeFullUrl} />
    </>
  );
});

export default GithubBadge;
