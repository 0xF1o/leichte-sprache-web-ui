import type { AnalyseResult } from "./types";

export const DEFAULT_ANALYSE_URL = "https://api.leichte-sprache.ai/analyse?format=full";

/**
 * Akzeptiert beide Antwortformate:
 * - format=full: {"annotated_text": …, "statistics": …, "issues": …}
 * - format=annotated_text: {"annotated_text": …} (oder ein reiner Text)
 */
export async function analyseText(analyseUrl: string, text: string, signal?: AbortSignal): Promise<AnalyseResult> {
  let res: Response;
  try {
    res = await fetch(analyseUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
      signal,
    });
  } catch (err) {
    if ((err as Error).name === "AbortError") throw err;
    throw new Error("Die Analyse-API ist nicht erreichbar. Bitte Internetverbindung prüfen.");
  }
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
    const obj = body as { annotated_text?: string; statistics?: AnalyseResult["statistics"]; issues?: AnalyseResult["issues"] };
    if (typeof obj.annotated_text === "string") {
      return {
        annotatedText: obj.annotated_text,
        issues: Array.isArray(obj.issues) ? obj.issues : [],
        statistics: obj.statistics ?? null,
      };
    }
  }
  throw new Error("Unerwartetes Antwortformat von der Analyse-API.");
}
