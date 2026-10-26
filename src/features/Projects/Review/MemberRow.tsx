import { PROJECT_MEMBER_ROLES, type ProjectMemberRole } from '@lobechat/types';
import { Flexbox, Select, Text } from '@lobehub/ui';
import { useTranslation } from 'react-i18next';

import UserAvatar from '@/components/UserAvatar';
import type { ProjectMemberItem } from '@/services/projectReview';

interface MemberRowProps {
  busy: boolean;
  member: ProjectMemberItem;
  onRoleChange: (role: ProjectMemberRole | null) => void;
}

export function MemberRow({ busy, member, onRoleChange }: MemberRowProps) {
  const { t } = useTranslation('project');
  const name = member.user?.name ?? member.userId;
  return (
    <Flexbox horizontal align="center" gap={12} paddingBlock={12} paddingInline={16}>
      <UserAvatar avatar={member.user?.avatar} name={name} size={28} />
      <Flexbox flex={1} style={{ minWidth: 0 }}>
        <Text ellipsis>{name}</Text>
        {member.user?.email && name !== member.user.email && (
          <Text ellipsis fontSize={12} type="secondary">
            {member.user.email}
          </Text>
        )}
      </Flexbox>
      <Select
        aria-label={t('review.members.roleOf', { name })}
        disabled={busy}
        style={{ width: 180 }}
        value={member.role}
        options={[
          { label: t('review.members.inheritRole'), value: 'workspace' },
          ...PROJECT_MEMBER_ROLES.map((role) => ({ label: t(`review.role.${role}`), value: role })),
        ]}
        onChange={(role) =>
          role && onRoleChange(role === 'workspace' ? null : (role as ProjectMemberRole))
        }
      />
    </Flexbox>
  );
}
