import { Avatar } from '@lobehub/ui/base-ui';
import { createStaticStyles } from 'antd-style';
import { useTranslation } from 'react-i18next';

import { useAgentStore } from '@/store/agent';
import { agentSelectors } from '@/store/agent/selectors';

const styles = createStaticStyles(({ css }) => ({
  avatar: css`
    flex: none;
  `,
  title: css`
    overflow: hidden;
    flex: none;

    max-width: 160px;

    text-overflow: ellipsis;
    white-space: nowrap;
  `,
}));

/** Agent title/avatar for a background activity; fetches the config when it isn't cached yet. */
export const useAgentMeta = (id?: string) => {
  const loaded = useAgentStore((s) => !id || !!s.agentMap[id]);
  const title = useAgentStore((s) =>
    id ? agentSelectors.getAgentMetaById(id)(s).title : undefined,
  );
  const avatar = useAgentStore((s) =>
    id ? agentSelectors.getAgentMetaById(id)(s).avatar : undefined,
  );
  const background = useAgentStore((s) =>
    id ? agentSelectors.getAgentMetaById(id)(s).backgroundColor : undefined,
  );
  const useFetchAgentConfig = useAgentStore((s) => s.useFetchAgentConfig);
  useFetchAgentConfig(true, loaded || !id ? '' : id);
  return { avatar, background, title };
};

export const agentName = (id?: string) =>
  id ? agentSelectors.getAgentMetaById(id)(useAgentStore.getState()).title : undefined;

/** Avatar + title of the agent that owns a background activity. */
export function AgentName({ id }: { id: string }) {
  const { t } = useTranslation('chat');
  const { avatar, background, title } = useAgentMeta(id);
  const name = title || t('backgroundActivity.agent');
  return (
    <>
      <Avatar
        avatar={avatar}
        background={background}
        className={styles.avatar}
        shape={'square'}
        size={16}
      />
      <span className={styles.title} title={name}>
        {name}
      </span>
    </>
  );
}
