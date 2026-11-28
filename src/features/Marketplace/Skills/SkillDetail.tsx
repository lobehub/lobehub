import { agentDisplayName } from '@lobechat/types';
import { ActionIcon, Button, DropdownMenu, Flexbox, Icon, Markdown, Text } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { ExternalLink, MoreHorizontalIcon, Trash2Icon } from 'lucide-react';
import { memo, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import AgentAvatar from '@/components/AgentAvatar';
import { useDiscoverStore } from '@/store/discover';
import { skillSelectors } from '@/store/discover/selectors';
import { useToolStore } from '@/store/tool';
import { agentSkillsSelectors } from '@/store/tool/selectors';

import BackLink from './BackLink';
import MarketCard from './MarketCard';
import { DetailBodySkeleton } from './MarketSkeleton';
import SkillAgentList from './SkillAgentList';
import SkillIcon from './SkillIcon';
import SkillPromptMock from './SkillPromptMock';
import SkillReviews from './SkillReviews';
import SkillStats from './SkillStats';
import { useMarketSkillInstall } from './useMarketSkillInstall';
import { useSkillAgents } from './useSkillAgents';

const styles = stylex.create({
  facts: {
    display: 'grid',
    gridTemplateColumns: '120px minmax(0, 1fr)',
    rowGap: 10,
  },
  link: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
    minWidth: 0,
    color: {
      'default': cssVar.colorText,
      ':hover': cssVar.colorPrimary,
    },
  },
  status: {
    display: 'inline-flex',
    flex: 'none',
    alignItems: 'center',
    gap: 6,
    paddingBlock: 2,
    paddingInline: 8,
    borderRadius: 999,
    fontSize: 12,
    lineHeight: '18px',
    color: cssVar.colorSuccess,
    backgroundColor: cssVar.colorSuccessBg,
  },
});

const Section = ({ children, title }: { children: ReactNode; title: string }) => (
  <Flexbox gap={8}>
    <Text weight={600}>{title}</Text>
    <MarketCard>{children}</MarketCard>
  </Flexbox>
);

const ExternalLinkText = ({ href, label }: { href: string; label: string }) => (
  <a href={href} rel={'noreferrer'} target={'_blank'} {...stylex.props(styles.link)}>
    <Text ellipsis>{label}</Text>
    <Icon icon={ExternalLink} size={14} />
  </a>
);

/**
 * A market skill's own page. The header carries the install state and, once
 * installed, "Add to assistant"; under it a mock of the skill in use. Until an
 * assistant has it, the figures, facts and reviews follow; after that, the list
 * of assistants that have it. The SKILL.md the assistant follows closes the page.
 */
/** `onBack` draws an in-page back link; leave it out where the page header already has one. */
const SkillDetail = memo<{ identifier: string; onBack?: () => void }>(({ identifier, onBack }) => {
  const { t } = useTranslation('setting');
  const useFetchSkillDetail = useDiscoverStore((s) => s.useFetchSkillDetail);
  const { isLoading, queryKey } = useFetchSkillDetail({ identifier });
  const detail = useDiscoverStore(skillSelectors.skillDetail(queryKey));
  // Installed skills open here too; the library copy names them until the market answers.
  const local = useToolStore((s) =>
    agentSkillsSelectors.getMarketAgentSkills(s).find((skill) => skill.identifier === identifier),
  );
  const { error, install, installed, pending, uninstall } = useMarketSkillInstall(identifier);
  // The reviews section asks for the same page; its total is the strip's review count.
  const useFetchSkillComments = useDiscoverStore((s) => s.useFetchSkillComments);
  const { queryKey: commentsKey } = useFetchSkillComments({ identifier, pageSize: 6 });
  const commentCount = useDiscoverStore(skillSelectors.skillComments(commentsKey))?.totalCount;

  const name = detail?.name ?? local?.name ?? identifier;
  const description = detail?.description ?? local?.description ?? '';
  const github = detail?.github?.url;
  const skillAgents = useSkillAgents(identifier, installed);

  return (
    <Flexbox gap={12}>
      {onBack && <BackLink onClick={onBack} />}
      <Flexbox gap={24}>
        <Flexbox horizontal align={'center'} gap={16}>
          <SkillIcon category={detail?.category} size={56} />
          <Flexbox flex={1} gap={4} style={{ minWidth: 0 }}>
            <Flexbox horizontal align={'center'} gap={8}>
              <Text ellipsis fontSize={18} weight={600}>
                {name}
              </Text>
              {installed && (
                <span {...stylex.props(styles.status)}>{t('market.skills.installed')}</span>
              )}
            </Flexbox>
            <Text ellipsis={{ rows: 2 }} type={'secondary'}>
              {description}
            </Text>
          </Flexbox>
          {installed ? (
            <Flexbox horizontal align={'center'} gap={8}>
              <DropdownMenu
                placement={'bottomRight'}
                items={
                  skillAgents.available.length > 0
                    ? skillAgents.available.map((agent) => {
                        const agentName = agentDisplayName(
                          agent,
                          t('defaultSession', { ns: 'common' }),
                        );
                        return {
                          icon: (
                            <AgentAvatar
                              agentId={agent.id}
                              avatar={typeof agent.avatar === 'string' ? agent.avatar : undefined}
                              background={agent.backgroundColor || undefined}
                              name={agentName}
                              size={20}
                            />
                          ),
                          key: agent.id,
                          label: agentName,
                          onClick: () => void skillAgents.add(agent.id),
                        };
                      })
                    : [
                        {
                          disabled: true,
                          key: 'empty',
                          label: t('market.skills.agents.noneToAdd'),
                        },
                      ]
                }
                popupProps={{
                  // One row per assistant: keep it a narrow, scrolling list beside the button.
                  style: { maxHeight: 360, maxWidth: 280, minWidth: 200, overflowY: 'auto' },
                }}
              >
                <Button type={'fill'}>{t('market.skills.addToAgent')}</Button>
              </DropdownMenu>
              <DropdownMenu
                placement={'bottomRight'}
                items={[
                  {
                    danger: true,
                    icon: <Icon icon={Trash2Icon} />,
                    key: 'uninstall',
                    label: t('market.skills.uninstall'),
                    onClick: () => void uninstall(),
                  },
                ]}
              >
                <ActionIcon icon={MoreHorizontalIcon} loading={pending} variant={'filled'} />
              </DropdownMenu>
            </Flexbox>
          ) : (
            <Button loading={pending} type={'fill'} onClick={() => void install()}>
              {t('market.skills.install')}
            </Button>
          )}
        </Flexbox>
        {error && <Text type={'danger'}>{t('market.skills.installFailed')}</Text>}
        <SkillPromptMock
          agents={installed ? skillAgents.added.filter((item) => item.enabled) : []}
          category={detail?.category}
          identifier={identifier}
          name={name}
        />
        {isLoading && !detail ? (
          <DetailBodySkeleton />
        ) : (
          detail && (
            <>
              {installed ? (
                <SkillAgentList
                  agents={skillAgents.added}
                  loading={skillAgents.loading}
                  pendingIds={skillAgents.pendingIds}
                  onRemove={(agentId) => void skillAgents.remove(agentId)}
                  onRemoveAll={() => void skillAgents.removeAll()}
                  onToggle={(agentId, on) => void skillAgents.toggle(agentId, on)}
                />
              ) : (
                <>
                  <SkillStats
                    data={{
                      category: detail.category,
                      commentCount,
                      installCount: detail.installCount,
                      ratingAverage: detail.ratingAverage,
                      ratingCount: detail.ratingCount,
                      stars: detail.github?.stars,
                      version: detail.version,
                    }}
                  />
                  <Section title={t('market.detail.info')}>
                    <div {...stylex.props(styles.facts)}>
                      {detail.author?.name && (
                        <>
                          <Text type={'secondary'}>{t('market.detail.developer')}</Text>
                          {detail.author.url ? (
                            <ExternalLinkText href={detail.author.url} label={detail.author.name} />
                          ) : (
                            <Text>{detail.author.name}</Text>
                          )}
                        </>
                      )}
                      {github && (
                        <>
                          <Text type={'secondary'}>GitHub</Text>
                          <ExternalLinkText
                            href={github}
                            label={github.replace(/^https?:\/\/github\.com\//, '')}
                          />
                        </>
                      )}
                      {detail.homepage && detail.homepage !== github && (
                        <>
                          <Text type={'secondary'}>{t('market.detail.website')}</Text>
                          <ExternalLinkText href={detail.homepage} label={detail.homepage} />
                        </>
                      )}
                    </div>
                  </Section>
                  <SkillReviews
                    identifier={identifier}
                    ratingAverage={detail.ratingAverage}
                    ratingCount={detail.ratingCount}
                  />
                </>
              )}
              {detail.content && (
                <Section title={'SKILL.md'}>
                  <Markdown fontSize={14} variant={'chat'}>
                    {detail.content}
                  </Markdown>
                </Section>
              )}
            </>
          )
        )}
      </Flexbox>
    </Flexbox>
  );
});

SkillDetail.displayName = 'MarketSkillDetail';

export default SkillDetail;
