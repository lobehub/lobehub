'use client';

import type { BuiltinRenderProps } from '@lobechat/types';
import { fromNow } from '@lobechat/utils/time';
import { Block, Flexbox, Highlighter, Icon, Markdown, Tag, Text } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { ExternalLink, Inbox, Link2 } from 'lucide-react';
import type { ReactNode } from 'react';
import { memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import {
  buildLinearRenderModel,
  formatIsoDate,
  isUuidLike,
  type LinearEntity,
  type LinearField,
  type LinearLink,
} from './utils';

const styles = stylex.create({
  container: { overflow: 'hidden', minWidth: '0' },
  description: {
    overflow: 'auto',
    maxHeight: '180px',
    paddingBlock: '8px',
    paddingInline: '10px',
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: cssVar.colorBorderSecondary,
    borderRadius: '6px',
    backgroundColor: cssVar.colorFillQuaternary,
    backgroundImage: 'none',
  },
  empty: {
    display: 'flex',
    gap: '6px',
    alignItems: 'center',
    justifyContent: 'center',
    paddingBlock: '16px',
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: cssVar.colorBorderSecondary,
    borderRadius: '6px',
    fontSize: '13px',
    color: cssVar.colorTextTertiary,
    backgroundColor: cssVar.colorFillQuaternary,
    backgroundImage: 'none',
  },
  entityHeader: {
    display: 'flex',
    gap: '12px',
    alignItems: 'center',
    justifyContent: 'space-between',
    minWidth: '0',
  },
  headLeft: { display: 'flex', gap: '6px', alignItems: 'center', minWidth: '0' },
  timeItem: {
    flexShrink: 0,
    fontSize: '12px',
    color: cssVar.colorTextTertiary,
    whiteSpace: 'nowrap',
  },
  metaItem: {
    display: 'inline-flex',
    gap: '4px',
    alignItems: 'baseline',
    minWidth: '0',
    fontSize: '12px',
    lineHeight: 1.5,
  },
  metaLabel: { flexShrink: 0, color: cssVar.colorTextTertiary },
  metaRow: {
    display: 'flex',
    flexWrap: 'wrap',
    rowGap: '4px',
    columnGap: '16px',
    alignItems: 'baseline',
    minWidth: '0',
  },
  metaValue: {
    overflow: 'hidden',
    minWidth: '0',
    color: cssVar.colorTextSecondary,
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  linkRow: {
    overflow: 'hidden',
    display: 'flex',
    gap: '8px',
    alignItems: 'center',
    minWidth: '0',
    paddingBlock: '6px',
    paddingInline: '8px',
    borderRadius: '6px',
    color: { 'default': cssVar.colorText, ':hover': cssVar.colorLink },
    backgroundColor: { 'default': cssVar.colorFillQuaternary, ':hover': cssVar.colorFillTertiary },
    backgroundImage: { 'default': 'none', ':hover': 'none' },
  },
  linkText: { overflow: 'hidden', minWidth: '0' },
  rawDetails: { fontSize: '12px', color: cssVar.colorTextSecondary },
  rawSummary: { cursor: 'pointer', width: 'fit-content', marginBlockEnd: '6px' },
  sectionLabel: { fontSize: '12px', color: cssVar.colorTextSecondary },
  titleLink: {
    display: 'inline-flex',
    gap: '4px',
    alignItems: 'center',
    minWidth: '0',
    color: { 'default': 'inherit', ':hover': cssVar.colorLink },
  },
});

const hasItems = <T,>(items: T[]) => items.length > 0;

const Section = memo<{ children: ReactNode; title: string }>(({ children, title }) => (
  <Flexbox gap={6}>
    <Text className={stylex.props(styles.sectionLabel).className}>{title}</Text>
    {children}
  </Flexbox>
));
Section.displayName = 'LinearRenderSection';

const MetaRow = memo<{ fields: LinearField[] }>(({ fields }) => {
  if (!hasItems(fields)) return null;

  return (
    <div {...stylex.props(styles.metaRow)}>
      {fields.map((field) => (
        <span {...stylex.props(styles.metaItem)} key={`${field.key}:${field.value}`}>
          <span {...stylex.props(styles.metaLabel)}>{field.label}</span>
          <span {...stylex.props(styles.metaValue)} title={field.value}>
            {field.value}
          </span>
        </span>
      ))}
    </div>
  );
});
MetaRow.displayName = 'LinearRenderMetaRow';

const LinkList = memo<{ links: LinearLink[] }>(({ links }) => {
  if (!hasItems(links)) return null;

  return (
    <Flexbox gap={4}>
      {links.map((link) => (
        <a
          {...stylex.props(styles.linkRow)}
          href={link.url}
          key={`${link.title}:${link.url}`}
          rel={'noreferrer'}
          target={'_blank'}
        >
          <Icon icon={Link2} size={13} />
          <Text ellipsis className={stylex.props(styles.linkText).className} title={link.title}>
            {link.title}
          </Text>
          <Icon icon={ExternalLink} size={12} />
        </a>
      ))}
    </Flexbox>
  );
});
LinkList.displayName = 'LinearRenderLinkList';

const EntityCard = memo<{ entity: LinearEntity }>(({ entity }) => {
  const { t } = useTranslation('plugin');
  const { title, id, url, state, updatedAt } = entity;

  // A bare UUID id only earns a slot when there's no title to carry the card
  // (e.g. comments / attachments, where it's also the link target). Human ids
  // like `LIN-123` always stay.
  const showId = Boolean(id) && (!title || !isUuidLike(id!));

  return (
    <Block gap={8} padding={10} variant={'outlined'} width={'100%'}>
      <div {...stylex.props(styles.entityHeader)}>
        <div {...stylex.props(styles.headLeft)}>
          {title &&
            (url ? (
              <a
                {...stylex.props(styles.titleLink)}
                href={url}
                rel={'noreferrer'}
                target={'_blank'}
              >
                <Text ellipsis weight={600}>
                  {title}
                </Text>
                <Icon icon={ExternalLink} size={12} />
              </a>
            ) : (
              <Text ellipsis weight={600}>
                {title}
              </Text>
            ))}
          {showId &&
            (url && !title ? (
              <a
                {...stylex.props(styles.titleLink)}
                href={url}
                rel={'noreferrer'}
                target={'_blank'}
              >
                <Tag size={'small'}>{id}</Tag>
                <Icon icon={ExternalLink} size={12} />
              </a>
            ) : (
              <Tag size={'small'}>{id}</Tag>
            ))}
          {state && (
            <Tag size={'small'} variant={'outlined'}>
              {state}
            </Tag>
          )}
        </div>
        {updatedAt && (
          <span {...stylex.props(styles.timeItem)} title={formatIsoDate(updatedAt)}>
            {t('builtins.linear.render.updatedAt', { time: fromNow(updatedAt) })}
          </span>
        )}
      </div>
      <MetaRow fields={entity.fields} />
      {entity.description && (
        <div {...stylex.props(styles.description)}>
          <Markdown fontSize={13} variant={'chat'}>
            {entity.description}
          </Markdown>
        </div>
      )}
      <LinkList links={entity.links} />
    </Block>
  );
});
EntityCard.displayName = 'LinearRenderEntityCard';

const LinearRender = memo<BuiltinRenderProps<Record<string, unknown>, unknown, unknown>>(
  ({ apiName, args, content, pluginError }) => {
    const { t } = useTranslation('plugin');
    const model = useMemo(
      () => buildLinearRenderModel({ apiName, args, content, pluginError }),
      [apiName, args, content, pluginError],
    );
    const hasResult =
      hasItems(model.resultEntities) ||
      Boolean(model.resultText) ||
      Boolean(model.rawResultJson) ||
      Boolean(model.emptyCollectionKey);

    // Request args are intentionally not rendered here — the Inspector already
    // surfaces the tool inputs, so duplicating them in the render is redundant.
    if (!hasResult && !model.errorText) return null;

    return (
      <Flexbox className={stylex.props(styles.container).className} gap={12}>
        {hasItems(model.resultEntities) && (
          <Flexbox gap={8}>
            {model.resultEntities.map((entity, index) => (
              <EntityCard
                entity={entity}
                key={`${entity.id || entity.title || 'entity'}:${index}`}
              />
            ))}
          </Flexbox>
        )}
        {model.emptyCollectionKey && (
          <div {...stylex.props(styles.empty)}>
            <Icon icon={Inbox} size={14} />
            <span>
              {t('builtins.linear.render.empty', { collection: model.emptyCollectionKey })}
            </span>
          </div>
        )}
        {model.resultText && (
          <Highlighter
            wrap
            language={'text'}
            showLanguage={false}
            style={{ maxHeight: 220, overflow: 'auto', paddingInline: 8 }}
            variant={'filled'}
          >
            {model.resultText}
          </Highlighter>
        )}
        {model.rawResultJson && (
          <details {...stylex.props(styles.rawDetails)}>
            <summary {...stylex.props(styles.rawSummary)}>Raw result</summary>
            <Highlighter
              wrap
              language={'json'}
              style={{ maxHeight: 260, overflow: 'auto', paddingInline: 8 }}
              variant={'filled'}
            >
              {model.rawResultJson}
            </Highlighter>
          </details>
        )}
        {model.errorText && (
          <Section title={'Error'}>
            <Highlighter
              wrap
              language={'text'}
              showLanguage={false}
              style={{ maxHeight: 220, overflow: 'auto', paddingInline: 8 }}
              variant={'filled'}
            >
              {model.errorText}
            </Highlighter>
          </Section>
        )}
      </Flexbox>
    );
  },
);

LinearRender.displayName = 'LinearRender';

export default LinearRender;
