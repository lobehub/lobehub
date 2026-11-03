/**
 * The data set for the RAGAS benchmark
 */
export interface RAGASDataSetItem {
  answer: string;
  context: string;
  ground_truth: string;
  question: string;
}
