export interface CreateVideoState {
  isCreating: boolean;
  isCreatingWithNewTopic: boolean;
}

export const initialCreateVideoState: CreateVideoState = {
  isCreating: false,
  isCreatingWithNewTopic: false,
};
