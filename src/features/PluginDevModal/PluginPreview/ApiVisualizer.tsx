'use client';

import { Block, Flexbox, Icon, Input, Tag } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { ChevronDown, ChevronRight, SearchIcon } from 'lucide-react';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';

const styles = stylex.create({
  apiDesc: {
    overflow: 'hidden',
    display: '-webkit-box',
    WebkitBoxOrient: 'vertical',
    WebkitLineClamp: '2',
    fontSize: '12px',
    color: cssVar.colorTextTertiary,
  },
  apiHeader: {
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  apiTitle: { fontFamily: cssVar.fontFamilyCode },
  emptyState: { padding: '32px', color: cssVar.colorTextDisabled, textAlign: 'center' },
  paramDesc: { fontSize: '12px', lineHeight: '18px', color: cssVar.colorTextSecondary },
  paramGrid: {
    display: 'grid',
    gridTemplateColumns: '1fr 2fr',
    gap: '12px',
    alignItems: 'center',
    marginBlockEnd: '12px',
  },
  paramName: { display: 'flex', gap: '6px', alignItems: 'center', fontFamily: 'monospace' },
  params: { color: cssVar.colorTextQuaternary },
  required: { marginInlineStart: '2px', color: cssVar.colorError },
  searchWrapper: { position: 'relative' },
  typeTag: {
    height: '20px',
    paddingBlock: '0',
    paddingInline: '6px',
    fontSize: '12px',
    lineHeight: '20px',
  },
});

interface ApiItemProps {
  api: {
    description: string;
    name: string;
    parameters: {
      properties: Record<string, { description: string; type: string }>;
      required: string[];
    };
  };
}

const ApiItem = memo<ApiItemProps>(({ api }) => {
  const [expanded, setExpanded] = useState(false);
  const { t } = useTranslation('plugin');

  const params = Object.entries(api.parameters.properties || {});
  return (
    <Block gap={8} padding={16}>
      <div {...stylex.props(styles.apiHeader)} onClick={() => setExpanded(!expanded)}>
        <Flexbox gap={8}>
          <div {...stylex.props(styles.apiTitle)}>{api.name}</div>
          <div {...stylex.props(styles.apiDesc)}>{api.description}</div>
        </Flexbox>

        <Icon icon={expanded ? ChevronDown : ChevronRight} />
      </div>

      {expanded && (
        <Flexbox
          gap={12}
          padding={16}
          style={{ background: cssVar.colorFillQuaternary, borderRadius: 6 }}
        >
          {params.length === 0 ? (
            <div {...stylex.props(styles.params)}>{t('dev.preview.api.noParams')}</div>
          ) : (
            <>
              <div {...stylex.props(styles.params)}>{t('dev.preview.api.params')}</div>
              <Flexbox gap={8} width={'100%'}>
                {params.map(([name, param]) => {
                  const isRequired = api.parameters.required?.includes(name);
                  return (
                    <div {...stylex.props(styles.paramGrid)} key={name}>
                      <div {...stylex.props(styles.paramName)}>
                        <span>{name}</span>
                        {isRequired && <span {...stylex.props(styles.required)}>*</span>}
                        <Tag className={stylex.props(styles.typeTag).className}>{param.type}</Tag>
                      </div>
                      <div {...stylex.props(styles.paramDesc)}>{param.description}</div>
                    </div>
                  );
                })}
              </Flexbox>
            </>
          )}
        </Flexbox>
      )}
    </Block>
  );
});

interface ApiVisualizerProps {
  apis: ApiItemProps['api'][];
}

const ApiVisualizer = memo<ApiVisualizerProps>(({ apis = [] }) => {
  const [searchQuery, setSearchQuery] = useState('');
  const { t } = useTranslation('plugin');

  const filteredApis = apis.filter(
    (api) =>
      api.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      api.description.toLowerCase().includes(searchQuery.toLowerCase()),
  );

  return (
    <Flexbox gap={8} width={'100%'}>
      <div {...stylex.props(styles.searchWrapper)}>
        <Input
          placeholder={t('dev.preview.api.searchPlaceholder')}
          prefix={<Icon icon={SearchIcon} />}
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
        />
      </div>

      <Flexbox gap={8} width={'100%'}>
        {filteredApis.length > 0 ? (
          filteredApis.map((api, index) => <ApiItem api={api} key={index} />)
        ) : (
          <div {...stylex.props(styles.emptyState)}>{t('dev.preview.api.noResults')}</div>
        )}
      </Flexbox>
    </Flexbox>
  );
});

export default ApiVisualizer;
