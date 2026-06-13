'use client';

import type { BuiltinRenderProps } from '@lobechat/types';
import { Block, Flexbox, Highlighter, Icon, Markdown, Tag, Text } from '@lobehub/ui';
import { createStaticStyles } from 'antd-style';
import { ExternalLink, Link2 } from 'lucide-react';
import type { ReactNode } from 'react';
import { memo, useMemo } from 'react';

import {
  buildLinearRenderModel,
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
    gap: 8px;
    align-items: flex-start;
    justify-content: space-between;

    min-width: 0;
  `,
  fieldGrid: css`
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
    gap: 6px;
  `,
  fieldItem: css`
    overflow: hidden;

    min-width: 0;
    padding-block: 6px;
    padding-inline: 8px;
    border-radius: 6px;

    background: ${cssVar.colorFillQuaternary};
  `,
  fieldLabel: css`
    display: block;
    margin-block-end: 2px;
    font-size: 11px;
    color: ${cssVar.colorTextTertiary};
  `,
  fieldValue: css`
    overflow: hidden;
    display: block;

    min-width: 0;

    font-size: 12px;
    color: ${cssVar.colorText};
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

const FieldGrid = memo<{ fields: LinearField[] }>(({ fields }) => {
  if (!hasItems(fields)) return null;

  return (
    <div className={styles.fieldGrid}>
      {fields.map((field) => (
        <div className={styles.fieldItem} key={`${field.key}:${field.value}`}>
          <span className={styles.fieldLabel}>{field.label}</span>
          <span className={styles.fieldValue} title={field.value}>
            {field.value}
          </span>
        </div>
      ))}
    </div>
  );
});
FieldGrid.displayName = 'LinearRenderFieldGrid';

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
  const title = entity.title || entity.id || 'Linear item';

  return (
    <Block gap={10} padding={10} variant={'outlined'} width={'100%'}>
      <div className={styles.entityHeader}>
        <Flexbox gap={4} style={{ minWidth: 0 }}>
          {entity.url ? (
            <a className={styles.titleLink} href={entity.url} rel={'noreferrer'} target={'_blank'}>
              <Text ellipsis={{ rows: 2 }} weight={600}>
                {title}
              </Text>
              <Icon icon={ExternalLink} size={12} />
            </a>
          ) : (
            <Text ellipsis={{ rows: 2 }} weight={600}>
              {title}
            </Text>
          )}
          <Flexbox horizontal gap={4} wrap={'wrap'}>
            {entity.id && <Tag size={'small'}>{entity.id}</Tag>}
            {entity.state && (
              <Tag size={'small'} variant={'outlined'}>
                {entity.state}
              </Tag>
            )}
          </Flexbox>
        </Flexbox>
      </div>
      <FieldGrid fields={entity.fields} />
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
    const hasRequest = hasItems(model.requestFields) || hasItems(model.requestLinks);
    const hasResult =
      hasItems(model.resultEntities) || Boolean(model.resultText) || Boolean(model.rawResultJson);

    if (!hasRequest && !hasResult && !model.errorText) return null;

    return (
      <Flexbox className={styles.container} gap={12}>
        {hasRequest && (
          <Section title={model.actionLabel || 'Request'}>
            <Block gap={8} padding={10} variant={'outlined'} width={'100%'}>
              <FieldGrid fields={model.requestFields} />
              <LinkList links={model.requestLinks} />
            </Block>
          </Section>
        )}
        {hasItems(model.resultEntities) && (
          <Section title={'Result'}>
            <Flexbox gap={8}>
              {model.resultEntities.map((entity, index) => (
                <EntityCard
                  entity={entity}
                  key={`${entity.id || entity.title || 'entity'}:${index}`}
                />
              ))}
            </Flexbox>
          </Section>
        )}
        {model.resultText && (
          <Section title={'Result'}>
            <Highlighter
              wrap
              language={'text'}
              showLanguage={false}
              style={{ maxHeight: 220, overflow: 'auto', paddingInline: 8 }}
              variant={'filled'}
            >
              {model.resultText}
            </Highlighter>
          </Section>
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
