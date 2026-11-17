import { Alert, Button, Checkbox, Flexbox, Icon, Text } from '@lobehub/ui';
import { SkillsIcon } from '@lobehub/ui/icons';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { useTranslation } from 'react-i18next';
import { Virtuoso } from 'react-virtuoso';

import { type SkillListItem, SkillsSearchBar } from '@/features/SkillsList';

import { useCanManageUserSkills } from './useCanManageUserSkills';
import { useUserSkillsManagement } from './useUserSkillsManagement';

const SKILL_ROW_HEIGHT = 36;

const styles = stylex.create({
  row: {
    display: 'flex',
    boxSizing: 'border-box',
    height: SKILL_ROW_HEIGHT,
    width: '100%',
    minWidth: 0,
    paddingBlock: '8px',
    paddingInline: '4px',
    borderRadius: '6px',
    backgroundColor: { 'default': 'transparent', ':hover': cssVar.colorFillTertiary },
  },
  rowText: { flex: '1', minWidth: 0 },
  footer: {
    paddingBlock: '12px',
    borderBlockStartWidth: '1px',
    borderBlockStartStyle: 'solid',
    borderBlockStartColor: cssVar.colorSplit,
  },
});

interface UserSkillsManagementProps {
  agentId: string;
  items: SkillListItem[];
  onClose: () => void;
}

export const UserSkillsManagement = ({ agentId, items, onClose }: UserSkillsManagementProps) => {
  const { t } = useTranslation(['chat', 'common']);
  const canEdit = useCanManageUserSkills(agentId);
  const selection = useUserSkillsManagement(agentId, items, canEdit);
  const selectedResults = selection.filteredItems.filter(({ id }) =>
    selection.isSelected(id),
  ).length;
  const disabled = !canEdit || selection.saving;

  return (
    <Flexbox gap={12}>
      <Text weight={500}>{t('workingPanel.skills.manage.title')}</Text>
      <SkillsSearchBar onSearch={selection.setQuery} />
      <Checkbox
        disabled={disabled || selection.filteredItems.length === 0}
        indeterminate={selectedResults > 0 && selectedResults < selection.filteredItems.length}
        checked={
          selection.filteredItems.length > 0 && selectedResults === selection.filteredItems.length
        }
        onChange={(checked) =>
          selection.setSelected(
            selection.filteredItems.map(({ id }) => id),
            checked,
          )
        }
      >
        {t('workingPanel.skills.manage.selectResults', { count: selection.filteredItems.length })}
      </Checkbox>
      {selection.filteredItems.length === 0 ? (
        <Text type="secondary">{t('workingPanel.skills.noSearchResults')}</Text>
      ) : (
        <Virtuoso
          computeItemKey={(_, item) => item.id}
          data={selection.filteredItems}
          fixedItemHeight={SKILL_ROW_HEIGHT}
          itemContent={(_, item) => (
            <Checkbox
              aria-label={item.name}
              checked={selection.isSelected(item.id)}
              disabled={disabled}
              classNames={{
                text: stylex.props(styles.rowText).className,
                wrapper: stylex.props(styles.row).className,
              }}
              onChange={(checked) => selection.setSelected([item.id], checked)}
            >
              <Flexbox horizontal align="center" gap={8} style={{ minWidth: 0 }}>
                <Icon icon={SkillsIcon} size={16} />
                <Text ellipsis fontSize={13} title={item.name}>
                  {item.name}
                </Text>
              </Flexbox>
            </Checkbox>
          )}
          style={{
            height: Math.min(selection.filteredItems.length * SKILL_ROW_HEIGHT, 360),
            maxHeight: '45vh',
          }}
        />
      )}
      {!canEdit && <Alert title={t('workingPanel.skills.manage.noPermission')} type="warning" />}
      {selection.saveFailed && (
        <Alert title={t('workingPanel.skills.manage.saveFailed')} type="error" />
      )}
      <Flexbox gap={8} {...stylex.props(styles.footer)}>
        <Text fontSize={12} type="secondary">
          {t('workingPanel.skills.manage.selected', { count: selection.selectedCount })}
          {selection.dirty && ` · ${t('workingPanel.skills.manage.unsaved')}`}
        </Text>
        <Flexbox horizontal gap={8} justify="flex-end">
          <Button disabled={selection.saving} size="small" onClick={onClose}>
            {t('cancel', { ns: 'common' })}
          </Button>
          <Button
            disabled={disabled || !selection.dirty}
            loading={selection.saving}
            size="small"
            type="primary"
            onClick={async () => {
              if (await selection.save()) onClose();
            }}
          >
            {t('workingPanel.skills.manage.save')}
          </Button>
        </Flexbox>
      </Flexbox>
    </Flexbox>
  );
};
