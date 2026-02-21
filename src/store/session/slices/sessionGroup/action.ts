import { t } from 'i18next';

import { message } from '@/components/AntdStaticMethods';
import { sessionService } from '@/services/session';
import { type SessionStore } from '@/store/session';
import { type StoreSetter } from '@/store/types';
import { type SessionGroupItem } from '@/types/session';

import { type SessionGroupsDispatch } from './reducer';
import { sessionGroupsReducer } from './reducer';

/* eslint-disable typescript-sort-keys/interface */

type Setter = StoreSetter<SessionStore>;
export const createSessionGroupSlice = (set: Setter, get: () => SessionStore, _api?: unknown) =>
  new SessionGroupActionImpl(set, get, _api);

export class SessionGroupActionImpl {
  readonly #get: () => SessionStore;
  readonly #set: Setter;

  constructor(set: Setter, get: () => SessionStore, _api?: unknown) {
    void _api;
    this.#set = set;
    this.#get = get;
  }

  addSessionGroup = async (name: string): Promise<string> => {
    const id = await sessionService.createSessionGroup(name);

    await this.#get().refreshSessions();

    return id;
  };

  clearSessionGroups = async (): Promise<void> => {
    await sessionService.removeSessionGroups();
    await this.#get().refreshSessions();
  };

  removeSessionGroup = async (id: string): Promise<void> => {
    await sessionService.removeSessionGroup(id);
    await this.#get().refreshSessions();
  };

  updateSessionGroupName = async (id: string, name: string): Promise<void> => {
    await sessionService.updateSessionGroup(id, { name });
    await this.#get().refreshSessions();
  };

  updateSessionGroupSort = async (items: SessionGroupItem[]): Promise<void> => {
    const sortMap = items.map((item, index) => ({ id: item.id, sort: index }));

    this.#get().internal_dispatchSessionGroups({ sortMap, type: 'updateSessionGroupOrder' });

    message.loading({
      content: t('sessionGroup.sorting', { ns: 'chat' }),
      duration: 0,
      key: 'updateSessionGroupSort',
    });

    await sessionService.updateSessionGroupOrder(sortMap);
    message.destroy('updateSessionGroupSort');
    message.success(t('sessionGroup.sortSuccess', { ns: 'chat' }));

    await this.#get().refreshSessions();
  };

  internal_dispatchSessionGroups = (payload: SessionGroupsDispatch): void => {
    const nextSessionGroups = sessionGroupsReducer(this.#get().sessionGroups, payload);
    this.#get().internal_processSessions(this.#get().sessions, nextSessionGroups);
  };
}

export type SessionGroupAction = Pick<SessionGroupActionImpl, keyof SessionGroupActionImpl>;
