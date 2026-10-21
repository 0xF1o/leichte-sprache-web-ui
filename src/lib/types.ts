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

/**
 * Eine abgeschlossene Korrektur-Runde: der von der KI umgeschriebene Text und
 * die anschließende Analyse dieses Textes (null = Analyse fehlgeschlagen).
 */
export interface FixRound {
  round: number;
  text: string;
  analysis: AnalyseResult | null;
  /** Dauer der Runde in Sekunden (Schreiben + Prüfung) */
  seconds: number;
  /** Tokens der Runde (Antwort + Denken) */
  tokens: number;
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
  /** Maximale Korrektur-Runden (1–10, Standard 3) */
  fixRounds: number;
  /** Toleranz: Korrektur stoppt, wenn so viele oder weniger Verstöße übrig sind (Standard 0) */
  tolerance: number;
}
