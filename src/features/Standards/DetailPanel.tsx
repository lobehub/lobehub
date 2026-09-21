'use client';

import { Flexbox, Icon, TextArea } from '@lobehub/ui';
import { ActionIcon, Button, type DropdownItem, DropdownMenu, Text } from '@lobehub/ui/base-ui';
import { createStaticStyles, cssVar } from 'antd-style';
import dayjs from 'dayjs';
import {
  ArchiveIcon,
  ArchiveRestoreIcon,
  ExternalLinkIcon,
  MoreHorizontalIcon,
} from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import RightPanel from '@/features/RightPanel';
import { expertiseService, type StandardItem } from '@/services/expertise';

import { useStandardRevisions, useStandardSources } from './hooks';

const styles = createStaticStyles(({ css }) => ({
  body: css`
    overflow-y: auto;
    flex: 1;
    padding-block: 20px;
    padding-inline: 20px;
  `,
  footer: css`
    flex: none;
    padding-block: 12px;
    padding-inline: 20px;
    border-block-start: 1px solid ${cssVar.colorBorderSecondary};
  `,
  header: css`
    flex: none;
    padding-block: 20px 0;
    padding-inline: 20px;
  `,
  source: css`
    padding-block-end: 12px;
    border-block-end: 1px solid ${cssVar.colorBorderSecondary};
  `,
  title: css`
    text-wrap: pretty;
  `,
}));

const SECTION_LABELS = {
  how: 'rules.section.how',
  limits: 'rules.section.limits',
  why: 'rules.section.why',
} as const;

const READING_ORDER = ['why', 'how', 'limits'] as const;

interface StandardBodyProps {
  onChanged: () => void;
  standard: StandardItem;
}

/**
 * One verifier end to end: what it rests on, where it came from, how to narrow it, and how to put
 * it away.
 *
 * The two actions are pinned rather than appended: archiving lives in the header menu and the
 * narrowing box is docked at the foot, because a verifier with a long source list pushes anything
 * placed after it past the bottom of the panel, where a short window never reaches it.
 */
const StandardBody = ({ onChanged, standard }: StandardBodyProps) => {
  const { t } = useTranslation('memory');
  const { data: sources } = useStandardSources(standard.id);
  const { data: revisions, mutate: mutateRevisions } = useStandardRevisions(standard.id);
  const [exception, setException] = useState('');
  const [busy, setBusy] = useState(false);
  const isArchived = standard.status === 'retired';

  const sectionBody = (key: string) =>
    standard.sections?.find((section) => section.key === key)?.body?.trim();

  const run = async (action: () => Promise<unknown>) => {
    if (busy) return;
    setBusy(true);
    try {
      await action();
      onChanged();
    } finally {
      setBusy(false);
    }
  };

  const addException = () => {
    const text = exception.trim();
    if (!text) return;
    return run(async () => {
      await expertiseService.reviseStandard(standard.id, text);
      setException('');
      await mutateRevisions();
    });
  };

  const menu: DropdownItem[] = [
    isArchived
      ? {
          icon: <Icon icon={ArchiveRestoreIcon} />,
          key: 'restore',
          label: t('rules.restore'),
          onClick: () => void run(() => expertiseService.restoreStandard(standard.id)),
        }
      : {
          danger: true,
          icon: <Icon icon={ArchiveIcon} />,
          key: 'archive',
          label: t('rules.archive'),
          onClick: () => void run(() => expertiseService.archiveStandard(standard.id)),
        },
  ];

  return (
    <Flexbox height={'100%'} width={'100%'}>
      <Flexbox horizontal align={'flex-start'} className={styles.header} gap={8}>
        <Flexbox flex={1} gap={4}>
          <Text className={styles.title} fontSize={16} weight={600}>
            {standard.title}
          </Text>
          {isArchived && (
            <Text fontSize={12} type={'secondary'}>
              {t('rules.archivedAt', {
                time: dayjs(standard.retiredAt ?? undefined).format('YYYY-MM-DD'),
              })}
            </Text>
          )}
        </Flexbox>
        <DropdownMenu items={menu}>
          <ActionIcon disabled={busy} icon={MoreHorizontalIcon} size={'small'} />
        </DropdownMenu>
      </Flexbox>

      <Flexbox className={styles.body} gap={20}>
        {READING_ORDER.map((key) => {
          const body = sectionBody(key);
          if (!body) return null;
          return (
            <Flexbox gap={4} key={key}>
              <Text fontSize={12} type={'secondary'}>
                {t(SECTION_LABELS[key])}
              </Text>
              <Text fontSize={13}>{body}</Text>
            </Flexbox>
          );
        })}

        <Flexbox gap={12}>
          <Text fontSize={12} type={'secondary'}>
            {t('rules.detail.sources')}
          </Text>
          {sources?.length ? (
            sources.map((source) => (
              <Flexbox className={styles.source} gap={6} key={source.id}>
                {source.checkTitle && (
                  <Text fontSize={13} weight={500}>
                    {source.checkTitle}
                  </Text>
                )}
                {source.reviewerComment && (
                  <Text fontSize={13} type={'secondary'}>
                    {t('rules.reviewerSaid')}：{source.reviewerComment}
                  </Text>
                )}
                <Flexbox horizontal align={'center'} gap={8} justify={'space-between'}>
                  <Text fontSize={12} type={'secondary'}>
                    {dayjs(source.createdAt).format('YYYY-MM-DD')}
                  </Text>
                  {source.acceptanceId && (
                    <Button
                      ghost
                      href={`/acceptance/${source.acceptanceId}`}
                      icon={<Icon icon={ExternalLinkIcon} />}
                      size={'small'}
                      target={'_blank'}
                      type={'link'}
                    >
                      {t('rules.openAcceptance')}
                    </Button>
                  )}
                </Flexbox>
              </Flexbox>
            ))
          ) : (
            <Text fontSize={13} type={'secondary'}>
              {t('rules.detail.sourcesEmpty')}
            </Text>
          )}
        </Flexbox>

        {Boolean(revisions?.length) && (
          <Flexbox gap={8}>
            <Text fontSize={12} type={'secondary'}>
              {t('rules.detail.revisions')}
            </Text>
            {revisions!.map((revision) => (
              <Flexbox gap={2} key={revision.id}>
                <Text fontSize={13}>{revision.feedback}</Text>
                <Text fontSize={12} type={'secondary'}>
                  {revision.changedBy === 'user'
                    ? t('rules.revisedByYou')
                    : t('rules.revisedBySystem')}
                  {' · '}
                  {dayjs(revision.createdAt).format('YYYY-MM-DD')}
                </Text>
              </Flexbox>
            ))}
          </Flexbox>
        )}
      </Flexbox>

      {/* Narrowing is the correction the reviewer actually makes — "this does not count inside a
          chart" — so it is one sentence docked where a composer goes, not a form. */}
      {!isArchived && (
        <Flexbox horizontal align={'flex-end'} className={styles.footer} gap={8}>
          <TextArea
            autoSize={{ maxRows: 4, minRows: 1 }}
            disabled={busy}
            placeholder={t('rules.exception.placeholder')}
            style={{ flex: 1 }}
            value={exception}
            onChange={(e) => setException(e.target.value)}
            onKeyDown={(e) => {
              if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') void addException();
            }}
          />
          <Button
            disabled={!exception.trim()}
            loading={busy}
            size={'small'}
            type={'primary'}
            onClick={addException}
          >
            {t('rules.exception.submit')}
          </Button>
        </Flexbox>
      )}
    </Flexbox>
  );
};

interface DetailPanelProps {
  onChanged: () => void;
  onClose: () => void;
  standard?: StandardItem;
}

/**
 * The same draggable right panel the sibling memory surfaces use. Its visibility follows the
 * selection rather than the global toggle: until a verifier is picked the panel has nothing to
 * show, and an empty column of dead space is not worth the width.
 */
const DetailPanel = ({ onChanged, onClose, standard }: DetailPanelProps) => (
  <RightPanel expand={Boolean(standard)} onExpandChange={(next) => !next && onClose()}>
    {standard ? <StandardBody standard={standard} onChanged={onChanged} /> : null}
  </RightPanel>
);

export default DetailPanel;
