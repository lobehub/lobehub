'use client';

import { AGENT_CHAT_URL, AGENTS_OFFICIAL_URL } from '@lobechat/const';
import { Avatar, Button, copyToClipboard, Flexbox, Icon, Markdown, Text, toast } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { ChevronRight, Puzzle, UsersRound } from 'lucide-react';
import { memo, type ReactNode, useState } from 'react';
import { useTranslation } from 'react-i18next';
import urlJoin from 'url-join';

import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import { useDiscoverStore } from '@/store/discover';
import { skillSelectors } from '@/store/discover/selectors';
import type { DiscoverAssistantDetail } from '@/types/discover';

import { catalogStyles } from '../Catalog/styles';
import { useCatalogDetailNavigate } from '../Catalog/useCatalogDetailNavigate';
import { MARKETPLACE_SKILL_PATH } from '../paths';
import { AgentRowSkeleton } from './AgentSkeleton';
import IconTile from './IconTile';
import MarketAgentAvatar from './MarketAgentAvatar';
import MarketCard from './MarketCard';
import { useMarketAgentInstall } from './useMarketAgentInstall';

const styles = stylex.create({
  actions: {
    display: 'flex',
    flex: 'none',
    gap: 8,
  },
  clamp: {
    position: 'relative',
    overflow: 'hidden',
    maxHeight: 220,
    maskImage: 'linear-gradient(to bottom, black 70%, transparent)',
  },
  facts: {
    display: 'grid',
    gridTemplateColumns: '120px minmax(0, 1fr)',
    rowGap: 12,
  },
  link: {
    alignSelf: 'flex-start',
    padding: 0,
    borderWidth: 0,
    font: 'inherit',
    fontSize: 13,
    color: {
      'default': cssVar.colorTextTertiary,
      ':hover': cssVar.colorTextSecondary,
    },
    backgroundColor: 'transparent',
    cursor: 'pointer',
  },
  list: {
    margin: -16,
  },
  skill: {
    display: 'flex',
    alignItems: 'center',
    gap: 12,
    minWidth: 0,
    paddingBlock: 12,
    paddingInline: 16,
    borderBlockStartWidth: {
      'default': 1,
      ':first-child': 0,
    },
    borderBlockStartStyle: 'solid',
    borderBlockStartColor: cssVar.colorFillSecondary,
  },
  skillLink: {
    cursor: 'pointer',
    backgroundColor: {
      'default': 'transparent',
      ':hover': cssVar.colorFillQuaternary,
    },
  },
  status: {
    display: 'inline-flex',
    flex: 'none',
    alignItems: 'center',
    paddingBlock: 2,
    paddingInline: 8,
    borderRadius: 999,
    fontSize: 12,
    lineHeight: '18px',
    color: cssVar.colorTextSecondary,
    backgroundColor: cssVar.colorFillTertiary,
  },
  statusAdded: {
    color: cssVar.colorSuccess,
    backgroundColor: cssVar.colorSuccessBg,
  },
  text: {
    display: 'flex',
    flex: '1',
    flexDirection: 'column',
    minWidth: 0,
  },
  title: {
    marginBlock: 0,
    fontSize: 18,
    fontWeight: 600,
    lineHeight: 1.4,
  },
});

const Section = ({ children, title }: { children: ReactNode; title: string }) => (
  <Flexbox gap={8}>
    <Text as={'h2'} fontSize={14} weight={600}>
      {title}
    </Text>
    {children}
  </Flexbox>
);

/**
 * One plugin the Agent ships with. A Market skill shows as one (icon, name,
 * blurb) and opens its page; anything else (an MCP server, a built-in tool)
 * shows its identifier.
 */
const PluginRow = memo<{ identifier: string }>(({ identifier }) => {
  const navigate = useCatalogDetailNavigate();
  const useFetchSkillDetail = useDiscoverStore((s) => s.useFetchSkillDetail);
  const { isLoading, queryKey } = useFetchSkillDetail({ identifier });
  const skill = useDiscoverStore(skillSelectors.skillDetail(queryKey));

  if (isLoading && !skill) return <AgentRowSkeleton />;

  if (!skill)
    return (
      <div {...stylex.props(styles.skill)}>
        <IconTile size={36}>
          <Icon color={cssVar.colorTextSecondary} icon={Puzzle} size={18} />
        </IconTile>
        <Text ellipsis type={'secondary'}>
          {identifier}
        </Text>
      </div>
    );

  return (
    <div
      {...stylex.props(styles.skill, styles.skillLink)}
      onClick={() => navigate(urlJoin(MARKETPLACE_SKILL_PATH, identifier))}
    >
      <IconTile size={36}>
        <Avatar avatar={skill.icon || skill.name} shape={'square'} size={24} />
      </IconTile>
      <span {...stylex.props(styles.text)}>
        <Text ellipsis weight={500}>
          {skill.name}
        </Text>
        <Text ellipsis fontSize={12} type={'secondary'}>
          {skill.description}
        </Text>
      </span>
      <Icon color={cssVar.colorTextTertiary} icon={ChevronRight} size={16} />
    </div>
  );
});

PluginRow.displayName = 'MarketplaceAgentPluginRow';

/** The instructions, clamped to a few paragraphs until "Show all". */
const Instructions = memo<{ content: string }>(({ content }) => {
  const { t } = useTranslation('discover');
  const [open, setOpen] = useState(false);
  const long = content.length > 600;

  return (
    <Flexbox gap={8}>
      <div {...stylex.props(long && !open && styles.clamp)}>
        <Markdown fontSize={14} variant={'chat'}>
          {content}
        </Markdown>
      </div>
      {long && (
        <button type={'button'} {...stylex.props(styles.link)} onClick={() => setOpen(!open)}>
          {t(open ? 'marketplaceAgents.detail.showLess' : 'marketplaceAgents.detail.showAll')}
        </button>
      )}
    </Flexbox>
  );
});

Instructions.displayName = 'MarketplaceAgentInstructions';

/**
 * A Marketplace Agent's page: whether I have it, who made it and whether
 * LobeHub reviewed it, the skills it ships with, its instructions and facts.
 * "Add Agent" forks a copy into mine; once added, "Message" opens its chat.
 */
const AgentDetail = memo<{ detail: Partial<DiscoverAssistantDetail>; mobile?: boolean }>(
  ({ detail, mobile }) => {
    const { t, i18n } = useTranslation(['discover', 'common']);
    const navigate = useWorkspaceAwareNavigate();
    const identifier = detail.identifier ?? '';
    const title = detail.title || identifier;
    const { add, added, canCreate, localId, pending } = useMarketAgentInstall(identifier, title);

    const verified = !!detail.isValidated;
    // `user.*` are the author's private plugins: nothing anyone else can open or install.
    const plugins = (detail.config?.plugins ?? [])
      .map((entry) =>
        typeof entry === 'string' ? entry : (entry as { identifier: string }).identifier,
      )
      .filter((id) => !!id && !id.startsWith('user.'));
    const updatedAt = detail.updatedAt ?? detail.createdAt;
    const systemRole = detail.config?.systemRole;

    const openChat = (agentId: string) => navigate(AGENT_CHAT_URL(agentId, mobile));

    return (
      <div {...stylex.props(catalogStyles.frame)} data-testid={'assistant-detail-content'}>
        <Flexbox gap={24}>
          <Flexbox horizontal align={'flex-start'} gap={16} wrap={'wrap'}>
            <MarketAgentAvatar
              followPointer
              avatar={detail.avatar}
              identifier={identifier}
              size={56}
              title={title}
            />
            <Flexbox flex={1} gap={4} style={{ minWidth: 200 }}>
              <Flexbox horizontal align={'center'} gap={8}>
                <h1 {...stylex.props(styles.title)}>{title}</h1>
                <span {...stylex.props(styles.status, added && styles.statusAdded)}>
                  {t(added ? 'marketplaceAgents.added' : 'marketplaceAgents.detail.notAdded')}
                </span>
              </Flexbox>
              <Text ellipsis={{ rows: 2 }} type={'secondary'}>
                {[
                  detail.description,
                  detail.author && t('marketplaceAgents.by', { name: detail.author }),
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </Text>
            </Flexbox>
            <div {...stylex.props(styles.actions)}>
              <Button
                type={'fill'}
                onClick={async () => {
                  await copyToClipboard(urlJoin(AGENTS_OFFICIAL_URL, identifier));
                  toast.success(t('copySuccess', { ns: 'common' }));
                }}
              >
                {t('marketplaceAgents.detail.copyLink')}
              </Button>
              {added && localId ? (
                <Button type={'primary'} onClick={() => openChat(localId)}>
                  {t('marketplaceAgents.detail.message')}
                </Button>
              ) : (
                <Button
                  disabled={!canCreate}
                  loading={pending}
                  type={'primary'}
                  onClick={() => void add()}
                >
                  {t('marketplaceAgents.detail.add')}
                </Button>
              )}
            </div>
          </Flexbox>
          <Flexbox horizontal align={'center'} gap={8}>
            <Icon color={cssVar.colorTextTertiary} icon={UsersRound} size={14} />
            <Text fontSize={13} type={'secondary'}>
              {t(
                verified
                  ? 'marketplaceAgents.detail.noticeVerified'
                  : 'marketplaceAgents.detail.noticeCommunity',
                { author: detail.author },
              )}
            </Text>
          </Flexbox>
          {plugins.length > 0 && (
            <Section title={t('marketplaceAgents.detail.skills')}>
              <MarketCard gap={0}>
                <div {...stylex.props(styles.list)}>
                  {plugins.map((id) => (
                    <PluginRow identifier={id} key={id} />
                  ))}
                </div>
              </MarketCard>
            </Section>
          )}
          <Section title={t('marketplaceAgents.detail.info')}>
            <MarketCard gap={16}>
              {systemRole && <Instructions content={systemRole} />}
              <div {...stylex.props(styles.facts)}>
                {detail.author && (
                  <>
                    <Text type={'secondary'}>{t('marketplaceAgents.detail.author')}</Text>
                    <Text>{detail.author}</Text>
                  </>
                )}
                <Text type={'secondary'}>{t('marketplaceAgents.detail.source')}</Text>
                <Text>
                  {t(
                    verified
                      ? 'marketplaceAgents.detail.sourceVerified'
                      : 'marketplaceAgents.detail.sourceCommunity',
                  )}
                </Text>
                {detail.category && (
                  <>
                    <Text type={'secondary'}>{t('marketplaceAgents.detail.category')}</Text>
                    <Text>
                      {t(`category.assistant.${detail.category}`, {
                        defaultValue: detail.category,
                      })}
                    </Text>
                  </>
                )}
                {detail.currentVersion && (
                  <>
                    <Text type={'secondary'}>{t('marketplaceAgents.detail.version')}</Text>
                    <Text>{detail.currentVersion}</Text>
                  </>
                )}
                {updatedAt && (
                  <>
                    <Text type={'secondary'}>{t('marketplaceAgents.detail.updatedAt')}</Text>
                    <Text>
                      {new Intl.DateTimeFormat(i18n.language, { dateStyle: 'long' }).format(
                        new Date(updatedAt),
                      )}
                    </Text>
                  </>
                )}
              </div>
            </MarketCard>
          </Section>
        </Flexbox>
      </div>
    );
  },
);

AgentDetail.displayName = 'MarketplaceAgentDetail';

export default AgentDetail;
