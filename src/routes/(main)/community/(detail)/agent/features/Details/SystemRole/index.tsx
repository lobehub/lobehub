import { Block, Flexbox, Icon, Tag } from '@lobehub/ui';
import { cssVar } from 'antd-style';
import { MessageCircleHeartIcon, MessageCircleQuestionIcon } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import TokenTag from '../../../../../(list)/agent/features/List/TokenTag';
import Title from '../../../../../features/Title';
import MarkdownRender from '../../../../features/MakedownRender';
import { useDetailContext } from '../../DetailProvider';
import TagList from './TagList';

const Overview = memo(() => {
  const { t } = useTranslation('discover');
  const { tokenUsage, tags = [], config } = useDetailContext();

  const { systemRole, openingMessage, openingQuestions } = config || {};
  return (
    <Flexbox gap={16}>
      {systemRole && (
        <>
          <Title tag={tokenUsage && <TokenTag tokenUsage={tokenUsage} />}>
            {t('assistants.details.systemRole.title')}
          </Title>
          <Block gap={16} padding={16} variant={'outlined'}>
            {<MarkdownRender>{systemRole.trimEnd()}</MarkdownRender>}
            <TagList tags={tags} />
          </Block>
        </>
      )}
      {openingMessage && (
        <>
          <Title>{t('assistants.details.systemRole.openingMessage')}</Title>
          <Block horizontal align={'flex-start'} gap={12} padding={16} variant={'outlined'}>
            <Icon
              color={cssVar.colorError}
              icon={MessageCircleHeartIcon}
              size={20}
              style={{
                marginTop: 4,
              }}
            />
            <MarkdownRender>{openingMessage?.trimEnd()}</MarkdownRender>
          </Block>
        </>
      )}
      {openingQuestions && (
        <>
          <Title tag={<Tag>{openingQuestions?.length}</Tag>}>
            {t('assistants.details.systemRole.openingQuestions')}
          </Title>
          <Flexbox gap={8}>
            {openingQuestions?.map((item, key) => (
              <Block horizontal gap={12} key={key} padding={16} variant={'outlined'}>
                <Icon color={cssVar.colorWarning} icon={MessageCircleQuestionIcon} size={20} />
                <MarkdownRender>{item}</MarkdownRender>
              </Block>
            ))}
          </Flexbox>
        </>
      )}
    </Flexbox>
  );
});

export default Overview;
