'use client';

import { Flexbox, Icon } from '@lobehub/ui';
import { Avatar, Text } from '@lobehub/ui/base-ui';
import { createStaticStyles, cssVar, cx } from 'antd-style';
import { GitPullRequest } from 'lucide-react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { useAcceptanceScope } from '../AcceptanceScope';
import { acceptanceCodingScope } from '../History/codingScope';
import { useAcceptanceBundle } from '../useAcceptanceBundle';
import AcceptanceStatusPill from './AcceptanceStatusPill';

const styles = createStaticStyles(({ css }) => ({
  titleRow: css`
    /* The per-check entry keeps its box at all times and only shows its ink on
       hover: revealing it by reflow would retitle the row under the pointer,
       and the title is what the reader is aiming at. It fades rather than
       hiding, so it stays in the tab order and in the accessibility tree —
       a hidden visibility would drop it from both, and the focus rule below
       could never fire. The pointer-events switch keeps the faded box from
       swallowing clicks meant for the title. Touch never hovers, which is why the button
       removes itself outright below this breakpoint. */
    [data-role='focus-entry'] {
      pointer-events: none;
      flex: none;
      opacity: 0;
      transition: opacity 150ms ease;
    }

    &:hover [data-role='focus-entry'],
    &:focus-within [data-role='focus-entry'] {
      pointer-events: auto;
      opacity: 1;
    }

    @media (width <= 767px) {
      padding-inline-end: 48px;
    }
  `,
  metaRow: css`
    font-size: 13px;
    color: ${cssVar.colorTextSecondary};
  `,
  scopeLink: css`
    cursor: pointer;
    color: ${cssVar.colorTextSecondary};

    &:hover {
      color: ${cssVar.colorText};
      text-decoration: underline;
    }
  `,
}));

interface AcceptanceIdentityProps {
  /** Rendered after the title, revealed on hover — the per-check entry point. */
  focusSlot?: ReactNode;
  statusSlot?: ReactNode;
  topicSlot?: ReactNode;
}

/**
 * The delivery's name, then one bar of everything that qualifies it.
 *
 * The name leads, the way a pull request leads with its own: it is what a
 * reader scans for, and putting the state above it made the state the headline
 * of a record whose headline is its subject. The per-check entry trails the
 * name and stays invisible until the row is hovered — it is a way in, not a
 * fact about the delivery, and standing there permanently it competed with
 * every fact beside it. Under the name, a single bar carries state, who
 * delivered it, and where it came from — the agent, the originating
 * conversation, the pull request — because those were three separate rows
 * saying one thing: the context of this record.
 *
 * The pass/uncertain tally and the last-run time are gone from here. They
 * change every round and read as the delivery's verdict while sitting above
 * the checklist that actually shows them, so the header claimed an outcome the
 * reader had not reached yet.
 */

const AcceptanceIdentity = ({ focusSlot, statusSlot, topicSlot }: AcceptanceIdentityProps) => {
  const { t } = useTranslation('verify');
  const { acceptanceId, embedded } = useAcceptanceScope();
  const { data } = useAcceptanceBundle(acceptanceId);
  if (!data) return null;

  const { acceptance, author, origin, rounds, subject } = data;
  const authorName = author?.fullName || author?.username;
  const scope = acceptanceCodingScope(rounds);
  const pullRequest = scope?.pullRequest;
  const originAgent = embedded ? null : origin?.agent;
  const agentName = originAgent?.title ?? t('acceptance.origin.agentFallback');

  return (
    <Flexbox gap={10}>
      {/* No subject-type tag beside the name. Which KIND of thing was
          delivered is a fact about the plumbing, not about the delivery a
          reader came to judge — and it sat where the title's own meaning
          should carry. */}
      <Flexbox horizontal align={'center'} className={styles.titleRow} gap={10} wrap={'wrap'}>
        <Text ellipsis as={'h1'} style={{ fontSize: 18, margin: 0, minWidth: 0 }}>
          {subject.title ?? subject.id}
        </Text>
        {focusSlot && <div data-role={'focus-entry'}>{focusSlot}</div>}
      </Flexbox>

      <Flexbox horizontal align={'center'} className={styles.metaRow} gap={12} wrap={'wrap'}>
        {statusSlot ?? <AcceptanceStatusPill status={acceptance.status} />}
        {/* Who delivered this, right after its state — the same place a pull
            request names its author. A shared record with no name on it reads
            as nobody's, and the status alone never says whose work it is. */}
        {authorName && (
          <Flexbox horizontal align={'center'} gap={6}>
            <Avatar avatar={author?.avatar || authorName.slice(0, 1)} size={18} />
            <Text style={{ color: cssVar.colorText, fontSize: 'inherit' }}>{authorName}</Text>
          </Flexbox>
        )}
        {originAgent && (
          <Flexbox horizontal align={'center'} gap={6} style={{ cursor: 'default' }}>
            {/* Beside the author's face, an agent with no picture used to draw
                the library's "UN" placeholder — two avatars in one bar, one of
                them claiming a name nobody has. Fall back to its own initial,
                the way the author's does. */}
            <Avatar
              avatar={originAgent.avatar || agentName.slice(0, 1)}
              background={originAgent.backgroundColor ?? undefined}
              size={18}
            />
            {agentName}
          </Flexbox>
        )}
        {topicSlot}
        {pullRequest?.number ? (
          pullRequest.url ? (
            <a
              className={cx(styles.scopeLink)}
              href={pullRequest.url}
              rel={'noreferrer'}
              target={'_blank'}
              title={pullRequest.title ?? pullRequest.url}
            >
              <Flexbox horizontal align={'center'} gap={4}>
                <Icon icon={GitPullRequest} size={13} /> #{pullRequest.number}
              </Flexbox>
            </a>
          ) : (
            <Flexbox horizontal align={'center'} gap={4}>
              <Icon icon={GitPullRequest} size={13} /> #{pullRequest.number}
            </Flexbox>
          )
        ) : null}
      </Flexbox>
    </Flexbox>
  );
};

export default AcceptanceIdentity;
