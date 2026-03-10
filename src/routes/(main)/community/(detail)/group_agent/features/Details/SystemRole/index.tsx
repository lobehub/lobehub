import { Block, Flexbox, Icon, Tag } from '@lobehub/ui';
import { cssVar } from 'antd-style';
import { MessageCircleHeartIcon, MessageCircleQuestionIcon } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import Title from '../../../../../features/Title';
import MarkdownRender from '../../../../features/MakedownRender';
import { useDetailContext } from '../../DetailProvider';
import TagList from './TagList';

const SystemRole = memo(() => {
  const { t } = useTranslation('discover');
  const { tokenUsage, tags = [], config } = useDetailContext();

  const { systemRole, openingMessage, openingQuestions } = config || {};
  return (
    <Flexbox gap={16}>
      {systemRole && (
        <>
          <Title tag={tokenUsage && <Tag>{t('groupAgents.details.tokenUsage', { defaultValue: `${tokenUsage} tokens` })}</Tag>}>
            {t('groupAgents.details.systemRole.title', { defaultValue: 'System Role' })}
          </Title>
          <Block gap={16} padding={16} variant={'outlined'}>
            {<MarkdownRender>{systemRole.trimEnd()}</MarkdownRender>}
            <TagList tags={tags} />
          </Block>
        </>
      )}
      {openingMessage && (
        <>
          <Title>
            {t('groupAgents.details.systemRole.openingMessage', {
              defaultValue: 'Opening Message',
            })}
          </Title>
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
      {openingQuestions && openingQuestions.length > 0 && (
        <>
          <Title tag={<Tag>{openingQuestions?.length}</Tag>}>
            {t('groupAgents.details.systemRole.openingQuestions', {
              defaultValue: 'Opening Questions',
            })}
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

export default SystemRole;
