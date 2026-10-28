import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { memo } from 'react';

import Avatar from '@/components/Avatar';

import KindIcon from '../components/KindIcon';
import { useEntityDataContext } from '../context';
import { useEntityFormat } from '../format';
import { type MemoryEntity } from '../types';
import { useSelection } from '../useSelection';
import Section from './Section';

const styles = stylex.create({
  grid: {
    display: 'grid',
    gap: '4px',
    gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
    marginInline: '-8px',
  },
  item: {
    alignItems: 'center',
    backgroundColor: {
      'default': 'transparent',
      ':hover': cssVar.colorFillTertiary,
    },
    borderRadius: cssVar.borderRadius,
    borderStyle: 'none',
    color: cssVar.colorText,
    cursor: 'pointer',
    display: 'flex',
    gap: '12px',
    paddingBlock: '8px',
    paddingInline: '8px',
    textAlign: 'start',
  },
  text: { display: 'flex', flexDirection: 'column', minWidth: 0 },
  name: {
    fontSize: '14px',
    fontWeight: 500,
    lineHeight: '20px',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  sub: {
    color: cssVar.colorTextTertiary,
    fontSize: '12px',
    lineHeight: '18px',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  names: { display: 'flex', flexWrap: 'wrap', gap: '8px' },
  chip: {
    alignItems: 'center',
    backgroundColor: cssVar.colorFillQuaternary,
    borderRadius: '999px',
    color: cssVar.colorTextSecondary,
    display: 'inline-flex',
    fontSize: '13px',
    gap: '6px',
    paddingBlock: '4px',
    paddingInlineEnd: '12px',
    paddingInlineStart: '4px',
  },
  chipPlain: { paddingInlineStart: '12px' },
  chipType: { color: cssVar.colorTextQuaternary, fontSize: '12px' },
});

/** Subject types the extractor uses for people. */
const PERSON_TYPES = new Set(['person', 'people', 'user', 'family', 'friend', 'colleague']);

interface RelatedProps {
  entity: MemoryEntity;
}

const Related = memo<RelatedProps>(({ entity }) => {
  const format = useEntityFormat();
  const { t } = format;
  const { entities, links } = useEntityDataContext();
  const { open } = useSelection();
  const typeOf = new Map(entity.names.map((n) => [n.name.toLowerCase(), n.type]));
  const mentioned = (links?.mentions.get(entity.id) ?? [])
    .filter((name) => name !== entity.title)
    .map((name) => ({ name, type: typeOf.get(name.toLowerCase()) }));
  const related = (links?.contexts.get(entity.id) ?? [])
    .map((link) => ({ ...link, target: entities.find((e) => e.id === link.targetId) }))
    .filter((item): item is typeof item & { target: MemoryEntity } => !!item.target)
    .slice(0, 8);

  return (
    <>
      {mentioned.length > 0 && (
        <Section title={t('entity.related.mentioned')}>
          <div {...stylex.props(styles.names)}>
            {mentioned.map(({ name, type }) => {
              const person = !!type && PERSON_TYPES.has(type.toLowerCase());
              return (
                <span key={name} {...stylex.props(styles.chip, !person && styles.chipPlain)}>
                  {person && (
                    <Avatar
                      avatar={undefined}
                      name={name}
                      shape={'circle'}
                      size={20}
                      title={name}
                    />
                  )}
                  {name}
                  {type && !person && <span {...stylex.props(styles.chipType)}>{type}</span>}
                </span>
              );
            })}
          </div>
        </Section>
      )}
      {related.length > 0 && (
        <Section extra={t('entity.related.contextsExtra')} title={t('entity.related.contexts')}>
          <div {...stylex.props(styles.grid)}>
            {related.map(({ names, target }) => (
              <button
                key={target.id}
                type={'button'}
                {...stylex.props(styles.item)}
                onClick={() => open(target.id)}
              >
                <KindIcon kind={target.kind} />
                <span {...stylex.props(styles.text)}>
                  <span {...stylex.props(styles.name)}>{format.title(target)}</span>
                  <span {...stylex.props(styles.sub)}>
                    {format.kind(target.kind)} ·{' '}
                    {t('entity.related.shared', { names: format.names(names) })}
                  </span>
                </span>
              </button>
            ))}
          </div>
        </Section>
      )}
    </>
  );
});

Related.displayName = 'EntityRelated';

export default Related;
