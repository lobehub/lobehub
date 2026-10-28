import { Flexbox, Text } from '@lobehub/ui';
import * as stylex from '@stylexjs/stylex';
import { useTranslation } from 'react-i18next';

import AgentAvatar from '@/components/AgentAvatar';

import type { composerRecipients } from './recipients';
import { styles } from './styles';

const MAX_AVATARS = 3;

/** Says who replies before the message is sent, so an unmentioned send never surprises. */
export function ComposerRecipients({
  recipients: { agents, kind },
}: {
  recipients: ReturnType<typeof composerRecipients>;
}) {
  const { t, i18n } = useTranslation('channel');
  const list = new Intl.ListFormat(i18n.language, { type: 'conjunction' });
  const names = agents.map((agent) => agent.name);
  const label =
    kind === 'all'
      ? t('recipients.all', { count: agents.length })
      : kind === 'named'
        ? names.length > MAX_AVATARS
          ? t('recipients.many', {
              count: names.length - 2,
              first: names[0],
              second: names[1],
              total: names.length,
            })
          : t('recipients.named', { names: list.format(names) })
        : t(`recipients.${kind}`);

  return (
    <Flexbox
      horizontal
      align="center"
      aria-live="polite"
      gap={6}
      {...stylex.props(styles.recipients)}
    >
      {agents.length > 0 && (
        <Flexbox horizontal flex="none" gap={2}>
          {agents.slice(0, MAX_AVATARS).map((agent) => (
            <AgentAvatar
              agentId={agent.agentId}
              avatar={agent.avatar}
              key={agent.id}
              name={agent.name}
              shape={'circle'}
              size={16}
              title={agent.name}
            />
          ))}
        </Flexbox>
      )}
      <Text ellipsis fontSize={12} title={label} type="secondary">
        {label}
      </Text>
    </Flexbox>
  );
}
