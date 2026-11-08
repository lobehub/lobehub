import { PROJECT_MEMBER_ROLES, type ProjectMemberRole } from '@lobechat/types';
import {
  Button,
  createModal,
  Empty,
  Flexbox,
  Icon,
  SearchBar,
  Select,
  Text,
  useModalContext,
} from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { t } from 'i18next';
import { CheckIcon, SearchXIcon, UsersIcon } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import UserAvatar from '@/components/UserAvatar';

import type { MemberCandidate } from './memberSearch';
import { filterMemberCandidates } from './memberSearch';
import { useMemberBatch } from './useMemberBatch';

const styles = stylex.create({
  footer: {
    paddingBlock: 12,
    paddingInline: 20,
    borderBlockStartWidth: 1,
    borderBlockStartStyle: 'solid',
    borderBlockStartColor: cssVar.colorBorderSecondary,
  },
  header: { paddingBlockStart: '4px', paddingBlockEnd: '12px', paddingInline: 20 },
  indicator: { display: 'inline-flex', color: cssVar.colorPrimary },
  list: {
    overflowY: 'auto',
    height: 'clamp(240px, calc(100dvh - 320px), 360px)',
    paddingBlockStart: '0',
    paddingBlockEnd: '8px',
    paddingInline: 12,
    userSelect: 'none',
  },
  row: {
    cursor: 'pointer',
    marginBlock: 2,
    paddingBlock: 10,
    paddingInline: 12,
    borderRadius: cssVar.borderRadius,
    backgroundColor: { 'default': 'transparent', ':hover': cssVar.colorFillTertiary },
  },
  selected: { backgroundColor: cssVar.colorFillQuaternary },
});

interface AddMemberContentProps {
  candidates: MemberCandidate[];
  /** Resolves once every chosen member holds the role; rejects to keep the dialog open. */
  onAdd: (userIds: string[], role: ProjectMemberRole) => Promise<void>;
}

const MemberOption = ({
  member,
  onToggle,
  selected,
}: {
  member: MemberCandidate;
  onToggle: () => void;
  selected: boolean;
}) => (
  <Flexbox
    horizontal
    align="center"
    aria-selected={selected}
    gap={12}
    role="option"
    tabIndex={0}
    {...stylex.props(styles.row, selected && styles.selected)}
    onClick={onToggle}
    onKeyDown={(event) => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      event.preventDefault();
      onToggle();
    }}
  >
    <UserAvatar avatar={member.avatar} name={member.name} size={36} />
    <Flexbox flex={1} gap={2} style={{ minWidth: 0 }}>
      <Text ellipsis weight={500}>
        {member.name}
      </Text>
      {member.email && member.email !== member.name && (
        <Text ellipsis fontSize={12} type="secondary">
          {member.email}
        </Text>
      )}
    </Flexbox>
    {selected && (
      <span {...stylex.props(styles.indicator)}>
        <Icon icon={CheckIcon} size="small" />
      </span>
    )}
  </Flexbox>
);

/**
 * Search the workspace by name or email, pick several people, and give them one project role.
 * Mirrors the collaborator picker so adding people reads the same everywhere.
 */
function AddMemberContent({ candidates, onAdd }: AddMemberContentProps) {
  const { t } = useTranslation('project');
  const { close } = useModalContext();
  const [query, setQuery] = useState('');
  const { adding, role, selected, setRole, submit, toggle } = useMemberBatch(onAdd, close);
  const filtered = filterMemberCandidates(candidates, query);

  return (
    <Flexbox>
      <Flexbox {...stylex.props(styles.header)}>
        <SearchBar
          autoFocus
          placeholder={t('review.members.search')}
          value={query}
          variant="filled"
          onChange={(event) => setQuery(event.target.value)}
        />
      </Flexbox>
      <Flexbox
        aria-multiselectable
        aria-disabled={adding}
        aria-label={t('review.members.add')}
        inert={adding}
        role="listbox"
        {...stylex.props(styles.list)}
      >
        {filtered.length ? (
          filtered.map((member) => (
            <MemberOption
              key={member.userId}
              member={member}
              selected={selected.includes(member.userId)}
              onToggle={() => toggle(member.userId)}
            />
          ))
        ) : (
          <Empty
            icon={candidates.length ? SearchXIcon : UsersIcon}
            style={{ paddingBlock: 48 }}
            description={t(
              candidates.length ? 'review.members.noMatch' : 'review.members.noCandidates',
            )}
          />
        )}
      </Flexbox>
      <Flexbox horizontal align="center" gap={8} {...stylex.props(styles.footer)}>
        <Flexbox horizontal align="center" flex={1} gap={8}>
          <Text fontSize={13} type="secondary">
            {t('review.members.addAs')}
          </Text>
          <Select
            aria-label={t('review.members.role')}
            disabled={adding}
            style={{ width: 140 }}
            value={role}
            options={PROJECT_MEMBER_ROLES.map((item) => ({
              label: t(`review.role.${item}`),
              value: item,
            }))}
            onChange={(value) => value && setRole(value as ProjectMemberRole)}
          />
        </Flexbox>
        <Button disabled={adding} onClick={close}>
          {t('cancel', { ns: 'common' })}
        </Button>
        <Button
          disabled={!selected.length}
          loading={adding}
          type="primary"
          onClick={() => void submit()}
        >
          {selected.length
            ? t('review.members.addCount', { count: selected.length })
            : t('review.members.add')}
        </Button>
      </Flexbox>
    </Flexbox>
  );
}

export const openAddMemberModal = (props: AddMemberContentProps) =>
  createModal({
    content: <AddMemberContent {...props} />,
    footer: null,
    // The content owns its paddings: search header, edge-to-edge list, divided footer.
    styles: { content: { overflow: 'hidden', padding: 0 } },
    title: t('review.members.add', { ns: 'project' }),
    width: 'min(90vw, 520px)',
  });
