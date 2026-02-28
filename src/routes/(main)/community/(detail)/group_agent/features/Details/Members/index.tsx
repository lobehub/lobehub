import { Avatar, Flexbox, Tag } from '@lobehub/ui';
import { Card, Typography } from 'antd';
import { Crown, User } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { useDetailContext } from '../../DetailProvider';

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
          <Flexbox horizontal align="center" gap={12}>
            <Avatar avatar={currentVersion.avatar || agent.name[0]} size={48} />
            <Flexbox flex={1} gap={4}>
              <Flexbox horizontal align="center" gap={8}>
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
          <Flexbox horizontal gap={8} wrap="wrap">
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
              ellipsis
              copyable={{ text: currentVersion.url }}
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
  const { memberAgents = [] } = useDetailContext();

  // Sort: supervisors first, then by displayOrder
  const sortedMembers = [...(memberAgents || [])].sort((a: any, b: any) => {
    const aRole = a.role || a.agent?.role;
    const bRole = b.role || b.agent?.role;
    if (aRole === 'supervisor' && bRole !== 'supervisor') return -1;
    if (aRole !== 'supervisor' && bRole === 'supervisor') return 1;
    const aOrder = a.displayOrder || a.agent?.displayOrder || 0;
    const bOrder = b.displayOrder || b.agent?.displayOrder || 0;
    return aOrder - bOrder;
  });

  return (
    <Flexbox gap={16}>
      <Title level={4}>
        {t('members.title', { defaultValue: 'Member Agents' })} ({memberAgents?.length || 0})
      </Title>

      <Flexbox gap={12}>
        {sortedMembers.map((member: any, index) => {
          // Support both flat structure and nested structure
          const agent = member.agent || member;
          const currentVersion = member.currentVersion || member;
          return (
            <MemberCard
              agent={agent}
              currentVersion={currentVersion}
              key={agent.identifier || index}
            />
          );
        })}
      </Flexbox>
    </Flexbox>
  );
});

export default Members;
