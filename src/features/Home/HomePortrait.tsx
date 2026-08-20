import { DEFAULT_INBOX_AVATAR } from '@lobechat/const';
import { createStaticStyles } from 'antd-style';
import { memo } from 'react';

import { resolveChiefAgentArtwork } from '@/features/ChiefAgent/artwork';
import { useAgentStore } from '@/store/agent';
import { agentSelectors } from '@/store/agent/selectors';

import { useResolvedHomeAgentId } from './AgentSelect/useResolvedHomeAgentId';

const styles = createStaticStyles(({ css }) => ({
  // Anchored below the greeting row rather than above the rail, so the agent
  // stands the same distance into the first card however the greeting wraps.
  image: css`
    pointer-events: none;

    position: absolute;
    inset-block-end: -64px;
    inset-inline-end: 12px;

    width: 152px;
    height: 152px;

    object-fit: contain;
  `,
  root: css`
    position: relative;
    height: 100%;
  `,
}));

const HomePortrait = memo(() => {
  // The portrait depicts whoever home is addressing, so it follows the same
  // selection the composer sends to — not the Inbox Agent it defaults to.
  const { agentId } = useResolvedHomeAgentId();
  const useFetchAgentConfig = useAgentStore((s) => s.useFetchAgentConfig);
  // A freshly picked agent may not be in the store yet; without this the
  // portrait would silently stay on the previous one's artwork.
  useFetchAgentConfig(true, agentId ?? '');

  const meta = useAgentStore(agentSelectors.getAgentMetaById(agentId ?? ''));
  // An agent that has been through the artwork studio shows its own character;
  // the built-in catalog covers everyone else.
  const fullBodyArtwork = useAgentStore(agentSelectors.getAgentFullBodyArtworkById(agentId ?? ''));
  const artwork = resolveChiefAgentArtwork(meta.avatar || DEFAULT_INBOX_AVATAR);
  const hero = fullBodyArtwork || artwork.hero;

  return (
    <div className={styles.root}>
      <img aria-hidden alt="" className={styles.image} key={hero} src={hero} />
    </div>
  );
});

export default HomePortrait;
