import { Flexbox } from '@lobehub/ui';
import { createStaticStyles, cssVar } from 'antd-style';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import InfoTooltip from '@/components/InfoTooltip';
import { useAgentStore } from '@/store/agent';
import { chatConfigByIdSelectors } from '@/store/agent/selectors';

import { useAgentId } from '../../hooks/useAgentId';
import { useUpdateAgentConfig } from '../../hooks/useUpdateAgentConfig';
import FunctionCallingModelSelect from './FunctionCallingModelSelect';

const styles = createStaticStyles(({ css }) => ({
  check: css`
    margin-inline-start: 12px;
    font-size: 16px;
    color: ${cssVar.colorPrimary};
  `,
  content: css`
    flex: 1;
    width: 230px;
  `,
  description: css`
    width: 200px;
    font-size: 12px;
    color: ${cssVar.colorTextSecondary};
  `,
  title: css`
    font-size: 14px;
    font-weight: 500;
    color: ${cssVar.colorText};
  `,
}));

const FCSearchModel = memo(() => {
  const { t } = useTranslation('chat');
  const agentId = useAgentId();
  const { updateAgentChatConfig } = useUpdateAgentConfig();
  const searchFCModel = useAgentStore((s) =>
    chatConfigByIdSelectors.getSearchFCModelById(agentId)(s),
  );
  return (
    <Flexbox horizontal distribution={'space-between'} gap={16} padding={8}>
      <Flexbox horizontal align={'center'} gap={4}>
        <Flexbox className={styles.title}>{t('search.searchModel.title')}</Flexbox>
        <InfoTooltip title={t('search.searchModel.desc')} />
      </Flexbox>
      <FunctionCallingModelSelect
        value={searchFCModel}
        style={{
          maxWidth: 160,
          width: 160,
        }}
        onChange={async (value) => {
          await updateAgentChatConfig({ searchFCModel: value });
        }}
      />
    </Flexbox>
  );
});

export default FCSearchModel;
