import { type AgentEvalDataset, type AgentEvalDatasetListItem } from '@lobechat/types';

export interface DatasetSliceState {
  datasetDetailMap: Record<string, AgentEvalDataset>;
  datasetList: AgentEvalDatasetListItem[];
  isLoadingDatasets: boolean;
  loadingDatasetDetailIds: string[];
}

export const datasetInitialState: DatasetSliceState = {
  datasetDetailMap: {},
  datasetList: [],
  isLoadingDatasets: true,
  loadingDatasetDetailIds: [],
};
