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

/**
 * Normalisiertes Ergebnis der Analyse – funktioniert sowohl mit
 * format=full (annotated_text + statistics + issues) als auch mit
 * format=annotated_text (nur annotated_text).
 */
export interface AnalyseResult {
  annotatedText: string;
  issues: Issue[];
  statistics: ViolationStatistics | null;
}

export interface AppSettings {
  /** Vollständige URL des Analyse-Endpoints (POST, JSON {"text": …}) */
  analyseUrl: string;
  /** Basis-URL des OpenAI-kompatiblen Modell-Endpunkts (endet auf /v1) */
  baseUrl: string;
  model: string;
  apiKey: string;
  /** Reasoning-Aufwand: "" = nicht setzen (Modell-Standard), sonst minimal/low/medium/high/xhigh */
  reasoningEffort: "" | "minimal" | "low" | "medium" | "high" | "xhigh";
  /** Selbstprüfung: Modell darf die Analyse per Tool-Calling selbst aufrufen */
  selfCheck: boolean;
}
