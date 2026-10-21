import type { AnalyseResult, Issue, ViolationStatistics } from "./types";

/**
 * Markierungen der annotierten Analyse im Text: [regel: …] bzw. [regel].
 * Bewusst NUR dieses enge Muster – von Nutzern geschriebene eckige Klammern
 * werden so nicht mitgezählt.
 */
const MARKER_RE = /\[[a-z0-9_]+(?::[^\[\]]*)?\]/gi;

/**
 * Anzahl der Verstöße eines Analyse-Ergebnisses (null = keine Analyse
 * vorhanden). Im annotated_text-Modus werden die Markierungen gezählt.
 */
export function violationCount(result: AnalyseResult | null): number | null {
  if (!result) return null;
  if (result.statistics) return result.statistics.total_violations;
  return (result.annotatedText.match(MARKER_RE) ?? []).length;
}

export const DEFAULT_ANALYSE_URL = "https://api.leichte-sprache.ai/analyse?format=full";

/** Standard: Zeit bis zur ersten Antwort des Servers (Verbindungs-Timeout). */
export const CONNECT_TIMEOUT_MS = 15000;

export interface ConnectGuard {
  /** An fetch zu übergebendes, kombiniertes Signal. */
  signal: AbortSignal;
  /** true, wenn das Timeout (nicht der Nutzer) die Anfrage abgebrochen hat. */
  timedOut: boolean;
  /** Timer aufräumen (nach erfolgreicher oder fehlgeschlagener Verbindung). */
  done: () => void;
}

/**
 * Verknüpft ein optionales externes AbortSignal (Nutzer-Abbruch) mit einem
 * Verbindungs-Timeout zu einem einzigen Signal für fetch.
 */
export function withConnectTimeout(signal?: AbortSignal, timeoutMs: number = CONNECT_TIMEOUT_MS): ConnectGuard {
  const controller = new AbortController();
  const onAbort = () => controller.abort();
  signal?.addEventListener("abort", onAbort, { once: true });
  if (signal?.aborted) controller.abort();
  const guard: ConnectGuard = { signal: controller.signal, timedOut: false, done: () => {} };
  let timer: ReturnType<typeof setTimeout> | undefined;
  timer = setTimeout(() => {
    guard.timedOut = true;
    controller.abort();
  }, timeoutMs);
  guard.done = () => {
    clearTimeout(timer);
    signal?.removeEventListener("abort", onAbort);
  };
  return guard;
}

/**
 * Akzeptiert beide Antwortformate:
 * - format=full: {"annotated_text": …, "statistics": …, "issues": …}
 * - format=annotated_text: {"annotated_text": …} (oder ein reiner Text)
 */
export async function analyseText(analyseUrl: string, text: string, signal?: AbortSignal): Promise<AnalyseResult> {
  const guard = withConnectTimeout(signal);
  let res: Response;
  try {
    res = await fetch(analyseUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
      signal: guard.signal,
    });
  } catch (err) {
    guard.done();
    if ((err as Error).name === "AbortError") {
      if (guard.timedOut) {
        throw new Error(`Zeitüberschreitung: Die Analyse-API hat nicht innerhalb von ${CONNECT_TIMEOUT_MS / 1000} s geantwortet.`);
      }
      throw err;
    }
    throw new Error("Die Analyse-API ist nicht erreichbar. Bitte Internetverbindung prüfen.");
  }
  guard.done();
  if (!res.ok) {
    let detail = "";
    try {
      const body = (await res.json()) as { detail?: string };
      detail = body.detail ? `: ${body.detail}` : "";
    } catch {
      /* ignore */
    }
    throw new Error(`Analyse fehlgeschlagen (HTTP ${res.status})${detail}`);
  }
  const body: unknown = await res.json();

  if (typeof body === "string") {
    return { annotatedText: body, issues: [], statistics: null };
  }
  if (body && typeof body === "object") {
    const obj = body as { annotated_text?: unknown; statistics?: unknown; issues?: unknown };
    if (typeof obj.annotated_text === "string") {
      return {
        annotatedText: obj.annotated_text,
        issues: normalizeIssues(obj.issues),
        statistics: normalizeStatistics(obj.statistics),
      };
    }
  }
  throw new Error("Unerwartetes Antwortformat von der Analyse-API.");
}

/**
 * Validiert die Issues aus der API-Antwort: Einträge ohne die erforderlichen
 * Felder werden verworfen, statt „undefined“ in der UI zu erzeugen.
 */
function normalizeIssues(raw: unknown): Issue[] {
  if (!Array.isArray(raw)) return [];
  const out: Issue[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const it = item as Partial<Issue>;
    if (typeof it.rule_id !== "string" || typeof it.text !== "string" || typeof it.message !== "string") continue;
    out.push({
      rule_id: it.rule_id,
      text: it.text,
      message: it.message,
      start: typeof it.start === "number" && Number.isFinite(it.start) ? it.start : null,
      end: typeof it.end === "number" && Number.isFinite(it.end) ? it.end : null,
    });
  }
  return out;
}

/** Validiert die Statistik aus der API-Antwort. */
function normalizeStatistics(raw: unknown): ViolationStatistics | null {
  if (!raw || typeof raw !== "object") return null;
  const s = raw as Partial<ViolationStatistics>;
  if (typeof s.total_violations !== "number" || typeof s.unique_violations !== "number") return null;
  const byRule: Record<string, number> = {};
  if (s.violations_by_rule && typeof s.violations_by_rule === "object") {
    for (const [k, v] of Object.entries(s.violations_by_rule)) {
      if (typeof v === "number") byRule[k] = v;
    }
  }
  return { total_violations: s.total_violations, unique_violations: s.unique_violations, violations_by_rule: byRule };
}
