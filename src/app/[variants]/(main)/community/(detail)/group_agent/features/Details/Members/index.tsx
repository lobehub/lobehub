import { Avatar, Flexbox, Tag } from '@lobehub/ui';
import { Card, Typography } from 'antd';
import { Crown, User } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { useDetailData } from '../../DetailProvider';

const { Title, Text, Paragraph } = Typography;

const MemberCard = memo(
  ({
    agent,
    currentVersion,
  }: {
    agent: any;
    currentVersion: any;
  }) => {
    const { t } = useTranslation('discover');
    const isSupervisor = agent.role === 'supervisor';

    return (
      <Card hoverable>
        <Flexbox gap={12}>
          {/* Avatar and Basic Info */}
          <Flexbox align="center" gap={12} horizontal>
            <Avatar avatar={currentVersion.avatar || agent.name[0]} size={48} />
            <Flexbox flex={1} gap={4}>
              <Flexbox align="center" gap={8} horizontal>
                <Title level={5} style={{ margin: 0 }}>
                  {currentVersion.name || agent.name}
                </Title>
                {isSupervisor ? (
                  <Tag color="gold" icon={<Crown size={12} />}>
                    {t('members.supervisor', { defaultValue: 'Supervisor' })}
                  </Tag>
                ) : (
                  <Tag color="blue" icon={<User size={12} />}>
                    {t('members.participant', { defaultValue: 'Participant' })}
                  </Tag>
                )}
              </Flexbox>
              <Text type="secondary">{agent.identifier}</Text>
            </Flexbox>
          </Flexbox>

          {/* Description */}
          {currentVersion.description && (
            <Paragraph ellipsis={{ rows: 2 }} style={{ margin: 0 }} type="secondary">
              {currentVersion.description}
            </Paragraph>
          )}

          {/* System Role (if available) */}
          {currentVersion.config?.systemRole && (
            <Flexbox gap={4}>
              <Text strong>{t('members.systemRole', { defaultValue: 'System Role' })}:</Text>
              <Paragraph ellipsis={{ rows: 3 }} style={{ margin: 0 }} type="secondary">
                {currentVersion.config.systemRole}
              </Paragraph>
            </Flexbox>
          )}

          {/* Metadata */}
          <Flexbox gap={8} horizontal wrap="wrap">
            {currentVersion.version && (
              <Text type="secondary">
                {t('members.version', { defaultValue: 'Version' })}: {currentVersion.version}
              </Text>
            )}
            {currentVersion.tokenUsage !== undefined && (
              <Text type="secondary">
                {t('members.tokenUsage', { defaultValue: 'Token Usage' })}:{' '}
                {currentVersion.tokenUsage}
              </Text>
            )}
          </Flexbox>

          {/* URL */}
          {currentVersion.url && (
            <Text
              copyable={{ text: currentVersion.url }}
              ellipsis
              style={{ fontSize: 12 }}
              type="secondary"
            >
              {currentVersion.url}
            </Text>
          )}
        </Flexbox>
      </Card>
    );
  },
);

MemberCard.displayName = 'MemberCard';

const Members = memo(() => {
  const { t } = useTranslation('discover');
  const data = useDetailData();

  const { memberAgents } = data;

  // Sort: supervisors first, then by displayOrder
  const sortedMembers = [...memberAgents].sort((a, b) => {
    if (a.agent.role === 'supervisor' && b.agent.role !== 'supervisor') return -1;
    if (a.agent.role !== 'supervisor' && b.agent.role === 'supervisor') return 1;
    return (a.agent.displayOrder || 0) - (b.agent.displayOrder || 0);
  });

  return (
    <Flexbox gap={16}>
      <Title level={4}>
        {t('members.title', { defaultValue: 'Member Agents' })} ({memberAgents.length})
      </Title>

      <Flexbox gap={12}>
        {sortedMembers.map((member, index) => (
          <MemberCard
            agent={member.agent}
            currentVersion={member.currentVersion}
            key={member.agent.identifier || index}
          />
        ))}
      </Flexbox>
    </Flexbox>
  );
});

export default Members;
