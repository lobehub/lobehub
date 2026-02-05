import { Collapse, Flexbox, Markdown } from '@lobehub/ui';
import qs from 'query-string';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import MarkdownRender from '../../../app/[variants]/(main)/community/(detail)/features/MakedownRender';
import McpList from '../../../app/[variants]/(main)/community/(list)/mcp/features/List';
import Title from '../../../app/[variants]/(main)/community/features/Title';
import { useDetailContext } from '../DetailProvider';
import TagList from './TagList';

const Overview = memo<{ inModal?: boolean }>(({ inModal }) => {
  const { t } = useTranslation('discover');
  const { related = [], category, tags = [], description, overview } = useDetailContext();

  const summary = overview?.summary || description;

  return (
    <Flexbox gap={48}>
      <Collapse
        defaultActiveKey={['summary']}
        expandIconPlacement={'end'}
        variant={'outlined'}
        items={[
          {
            children: !!summary ? <Markdown>{summary}</Markdown> : summary,
            key: 'summary',
            label: t('mcp.details.summary.title'),
          },
        ]}
      />
      <Flexbox gap={16}>
        {overview?.readme && <MarkdownRender>{overview.readme.trimEnd()}</MarkdownRender>}
        <TagList tags={tags} />
      </Flexbox>
      {!inModal && (
        <Flexbox gap={16}>
          <Title
            more={t('mcp.details.related.more')}
            moreLink={qs.stringifyUrl({
              query: {
                category,
              },
              url: '/community/mcp',
            })}
          >
            {t('mcp.details.related.listTitle')}
          </Title>
          <McpList data={related} />
        </Flexbox>
      )}
    </Flexbox>
  );
});

export default Overview;
