export interface Issue {
  rule_id: string;
  text: string;
  message: string;
  start: number | null;
  end: number | null;
}

export interface ViolationStatistics {
  total_violations: number;
  unique_violations: number;
  violations_by_rule: Record<string, number>;
}

export interface AnalyseResponse {
  annotated_text: string;
  statistics: ViolationStatistics;
  issues: Issue[];
}

export interface AppSettings {
  /** Vollständige URL des Analyse-Endpoints (POST, JSON {"text": …}) */
  analyseUrl: string;
  /** Basis-URL des OpenAI-kompatiblen Modell-Endpunkts (endet auf /v1) */
  baseUrl: string;
  model: string;
  apiKey: string;
}
