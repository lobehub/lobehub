'use client';

import type { BuiltinRenderProps } from '@lobechat/types';
import { fromNow } from '@lobechat/utils/time';
import { Block, Flexbox, Highlighter, Icon, Markdown, Tag, Text } from '@lobehub/ui';
import { createStaticStyles } from 'antd-style';
import { ExternalLink, Link2 } from 'lucide-react';
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

const styles = createStaticStyles(({ css, cssVar }) => ({
  container: css`
    overflow: hidden;
    min-width: 0;
  `,
  description: css`
    overflow: auto;

    max-height: 180px;
    padding-block: 8px;
    padding-inline: 10px;
    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: 6px;

    background: ${cssVar.colorFillQuaternary};
  `,
  entityHeader: css`
    display: flex;
    gap: 12px;
    align-items: center;
    justify-content: space-between;

    min-width: 0;
  `,
  headLeft: css`
    display: flex;
    gap: 6px;
    align-items: center;

    min-width: 0;
  `,
  timeItem: css`
    flex-shrink: 0;
    font-size: 12px;
    color: ${cssVar.colorTextTertiary};
    white-space: nowrap;
  `,
  metaItem: css`
    display: inline-flex;
    gap: 4px;
    align-items: baseline;

    min-width: 0;

    font-size: 12px;
    line-height: 1.5;
  `,
  metaLabel: css`
    flex-shrink: 0;
    color: ${cssVar.colorTextTertiary};
  `,
  metaRow: css`
    display: flex;
    flex-wrap: wrap;
    gap: 4px 16px;
    align-items: baseline;

    min-width: 0;
  `,
  metaValue: css`
    overflow: hidden;

    min-width: 0;

    color: ${cssVar.colorTextSecondary};
    text-overflow: ellipsis;
    white-space: nowrap;
  `,
  linkRow: css`
    overflow: hidden;
    display: flex;
    gap: 8px;
    align-items: center;

    min-width: 0;
    padding-block: 6px;
    padding-inline: 8px;
    border-radius: 6px;

    color: ${cssVar.colorText};

    background: ${cssVar.colorFillQuaternary};

    &:hover {
      color: ${cssVar.colorLink};
      background: ${cssVar.colorFillTertiary};
    }
  `,
  linkText: css`
    overflow: hidden;
    min-width: 0;
  `,
  rawDetails: css`
    font-size: 12px;
    color: ${cssVar.colorTextSecondary};

    summary {
      cursor: pointer;
      width: fit-content;
      margin-block-end: 6px;
    }
  `,
  sectionLabel: css`
    font-size: 12px;
    color: ${cssVar.colorTextSecondary};
  `,
  titleLink: css`
    display: inline-flex;
    gap: 4px;
    align-items: center;

    min-width: 0;

    color: inherit;

    &:hover {
      color: ${cssVar.colorLink};
    }
  `,
}));

const hasItems = <T,>(items: T[]) => items.length > 0;

const Section = memo<{ children: ReactNode; title: string }>(({ children, title }) => (
  <Flexbox gap={6}>
    <Text className={styles.sectionLabel}>{title}</Text>
    {children}
  </Flexbox>
));
Section.displayName = 'LinearRenderSection';

const MetaRow = memo<{ fields: LinearField[] }>(({ fields }) => {
  if (!hasItems(fields)) return null;

  return (
    <div className={styles.metaRow}>
      {fields.map((field) => (
        <span className={styles.metaItem} key={`${field.key}:${field.value}`}>
          <span className={styles.metaLabel}>{field.label}</span>
          <span className={styles.metaValue} title={field.value}>
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
          className={styles.linkRow}
          href={link.url}
          key={`${link.title}:${link.url}`}
          rel={'noreferrer'}
          target={'_blank'}
        >
          <Icon icon={Link2} size={13} />
          <Text ellipsis className={styles.linkText} title={link.title}>
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
  // like `LOBE-123` always stay.
  const showId = Boolean(id) && (!title || !isUuidLike(id!));

  return (
    <Block gap={8} padding={10} variant={'outlined'} width={'100%'}>
      <div className={styles.entityHeader}>
        <div className={styles.headLeft}>
          {title &&
            (url ? (
              <a className={styles.titleLink} href={url} rel={'noreferrer'} target={'_blank'}>
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
              <a className={styles.titleLink} href={url} rel={'noreferrer'} target={'_blank'}>
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
          <span className={styles.timeItem} title={formatIsoDate(updatedAt)}>
            {t('builtins.linear.render.updatedAt', { time: fromNow(updatedAt) })}
          </span>
        )}
      </div>
      <MetaRow fields={entity.fields} />
      {entity.description && (
        <div className={styles.description}>
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
    const model = useMemo(
      () => buildLinearRenderModel({ apiName, args, content, pluginError }),
      [apiName, args, content, pluginError],
    );
    const hasResult =
      hasItems(model.resultEntities) || Boolean(model.resultText) || Boolean(model.rawResultJson);

    // Request args are intentionally not rendered here — the Inspector already
    // surfaces the tool inputs, so duplicating them in the render is redundant.
    if (!hasResult && !model.errorText) return null;

    return (
      <Flexbox className={styles.container} gap={12}>
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
          <details className={styles.rawDetails}>
            <summary>Raw result</summary>
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
