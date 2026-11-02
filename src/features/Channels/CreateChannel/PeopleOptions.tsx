import { DEFAULT_USER_AVATAR } from '@lobechat/const';
import { ActionIcon, Checkbox, Flexbox, Text } from '@lobehub/ui';
import * as stylex from '@stylexjs/stylex';
import { useDebounce } from 'ahooks';
import { X } from 'lucide-react';
import type { Dispatch, SetStateAction } from 'react';
import { useTranslation } from 'react-i18next';

import AsyncBoundary from '@/components/AsyncBoundary';
import Avatar from '@/components/Avatar';
import type { ChannelPersonOption } from '@/services/channel';
import { channelActions } from '@/store/channel';

import { pickerStyles } from './pickerStyles';

/** The server returns at most this many candidates; searching narrows the rest. */
const CANDIDATE_LIMIT = 50;

export interface PeopleSelection {
  channelId: string;
  onChange: Dispatch<SetStateAction<ChannelPersonOption[]>>;
  value: ChannelPersonOption[];
}

export const usePersonName = () => {
  const { t } = useTranslation('channel');
  return (person: ChannelPersonOption) => person.fullName || person.username || t('person');
};

const PersonAvatar = ({ name, person }: { name: string; person: ChannelPersonOption }) => (
  <Avatar avatar={person.avatar || DEFAULT_USER_AVATAR} size={28} title={name} />
);

/** Workspace members who are not in the Channel yet, searched on the server. */
export const PeopleOptions = ({ people, search }: { people: PeopleSelection; search: string }) => {
  const { t } = useTranslation('channel');
  const nameOf = usePersonName();
  const query = useDebounce(search.trim(), { wait: 200 });
  const { data, error, isLoading, mutate } = channelActions.useFetchUserCandidates(
    people.channelId,
    query,
  );
  const toggle = (person: ChannelPersonOption) =>
    people.onChange((current) =>
      current.some((item) => item.userId === person.userId)
        ? current.filter((item) => item.userId !== person.userId)
        : [...current, person],
    );

  return (
    <Flexbox gap={2}>
      <Text fontSize={12} type="secondary" weight={500} {...stylex.props(pickerStyles.section)}>
        {t('invite.people')}
      </Text>
      <AsyncBoundary
        data={data}
        error={error}
        isEmpty={data?.length === 0}
        isLoading={isLoading}
        empty={
          <Text fontSize={12} type="secondary" {...stylex.props(pickerStyles.section)}>
            {t(query ? 'people.noMatches' : 'people.empty')}
          </Text>
        }
        onRetry={() => void mutate()}
      >
        {data?.map((person) => {
          const name = nameOf(person);
          return (
            <label key={person.userId} {...stylex.props(pickerStyles.row)}>
              <Checkbox
                checked={people.value.some((item) => item.userId === person.userId)}
                onChange={() => toggle(person)}
              />
              <PersonAvatar name={name} person={person} />
              <Text ellipsis>{name}</Text>
            </label>
          );
        })}
        {data?.length === CANDIDATE_LIMIT && (
          <Text fontSize={12} type="secondary" {...stylex.props(pickerStyles.section)}>
            {t('people.searchMore')}
          </Text>
        )}
      </AsyncBoundary>
    </Flexbox>
  );
};

export const SelectedPerson = ({
  onRemove,
  person,
}: {
  onRemove: () => void;
  person: ChannelPersonOption;
}) => {
  const { t } = useTranslation('chat');
  const name = usePersonName()(person);
  return (
    <Flexbox horizontal align="center" gap={8} padding={8}>
      <PersonAvatar name={name} person={person} />
      <Text ellipsis style={{ flex: 1 }}>
        {name}
      </Text>
      <ActionIcon
        aria-label={t('group.removeMember')}
        icon={X}
        size="small"
        title={t('group.removeMember')}
        onClick={onRemove}
      />
    </Flexbox>
  );
};
