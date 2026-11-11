interface SynapInputModality {
  supported_inputs?: {
    max_context_length?: { unit?: string; value?: number };
  };
  type: string;
}

interface SynapOutputModality {
  max_length?: { unit?: string; value?: number };
  streaming?: boolean;
  supported_parameters?: Record<string, unknown>;
  type: string;
}

/**
 * One row of Synap's `GET /v1/models`. The two router ids (`synap-v1`,
 * `synap-v1-pro`) and the two team-agent ids carry only `pricing`/`capability`;
 * the self-hosted fleet models additionally carry the full modality/pricing
 * breakdown once they have a `schema_version`.
 */
export interface SynapModelCard {
  capability?: string;
  context_note?: string;
  created?: number;
  id: string;
  input_modalities?: SynapInputModality[];
  name?: string;
  object?: string;
  output_modalities?: SynapOutputModality[];
  owned_by?: string;
  pricing?: {
    completion_per_million?: number;
    currency?: string;
    prompt_per_million?: number;
  };
}
