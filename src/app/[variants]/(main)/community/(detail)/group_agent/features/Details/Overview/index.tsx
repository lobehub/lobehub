import { Flexbox } from '@lobehub/ui';
import { Typography } from 'antd';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { Markdown } from '@lobehub/ui';

import { useDetailData } from '../../DetailProvider';

const { Title, Paragraph } = Typography;

const Overview = memo(() => {
  const { t } = useTranslation('discover');
  const data = useDetailData();

  const { currentVersion, group } = data;
  const description = currentVersion?.description || 'No description available.';
  const config = currentVersion?.config || {};

  return (
    <Flexbox gap={24}>
      {/* Description */}
      <Flexbox gap={8}>
        <Title level={4}>{t('overview.about', { defaultValue: 'About' })}</Title>
        <Markdown>{description}</Markdown>
      </Flexbox>

      {/* System Role (if available) */}
      {config.systemRole && (
        <Flexbox gap={8}>
          <Title level={4}>
            {t('overview.systemRole', { defaultValue: 'System Role' })}
          </Title>
          <Markdown>{config.systemRole}</Markdown>
        </Flexbox>
      )}

      {/* Opening Message (if available) */}
      {config.openingMessage && (
        <Flexbox gap={8}>
          <Title level={4}>
            {t('overview.openingMessage', { defaultValue: 'Opening Message' })}
          </Title>
          <Paragraph>{config.openingMessage}</Paragraph>
        </Flexbox>
      )}

      {/* Opening Questions (if available) */}
      {config.openingQuestions && config.openingQuestions.length > 0 && (
        <Flexbox gap={8}>
          <Title level={4}>
            {t('overview.openingQuestions', { defaultValue: 'Suggested Questions' })}
          </Title>
          <ul>
            {config.openingQuestions.map((question: string, index: number) => (
              <li key={index}>{question}</li>
            ))}
          </ul>
        </Flexbox>
      )}

      {/* Additional Info */}
      <Flexbox gap={8}>
        <Title level={4}>{t('overview.info', { defaultValue: 'Information' })}</Title>
        <Flexbox gap={8}>
          <Flexbox gap={4} horizontal>
            <strong>{t('overview.identifier', { defaultValue: 'Identifier' })}:</strong>
            <span>{group.identifier}</span>
          </Flexbox>
          <Flexbox gap={4} horizontal>
            <strong>{t('overview.visibility', { defaultValue: 'Visibility' })}:</strong>
            <span>{group.visibility || 'public'}</span>
          </Flexbox>
          {group.homepage && (
            <Flexbox gap={4} horizontal>
              <strong>{t('overview.homepage', { defaultValue: 'Homepage' })}:</strong>
              <a href={group.homepage} rel="noopener noreferrer" target="_blank">
                {group.homepage}
              </a>
            </Flexbox>
          )}
        </Flexbox>
      </Flexbox>
    </Flexbox>
  );
});

export default Overview;
