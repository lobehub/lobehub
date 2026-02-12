import { type ListItem } from './types';

export const menuKey = (provider: string, model: string) => `${provider}-${model}`;

export const getListItemKey = (item: ListItem): string => {
  switch (item.type) {
    case 'model-item-single':
    case 'model-item-multiple': {
      return item.data.displayName;
    }
    case 'provider-model-item': {
      return menuKey(item.provider.id, item.model.id);
    }
    case 'group-header': {
      return `header-${item.provider.id}`;
    }
    case 'empty-model': {
      return `empty-${item.provider.id}`;
    }
    case 'no-provider': {
      return 'no-provider';
    }
  }
};
