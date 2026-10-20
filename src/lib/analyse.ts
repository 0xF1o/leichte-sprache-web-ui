import type { AnalyseResponse } from "./types";

export const DEFAULT_ANALYSE_URL = "https://api.leichte-sprache.ai/analyse?format=full";

export async function analyseText(analyseUrl: string, text: string, signal?: AbortSignal): Promise<AnalyseResponse> {
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
  return (await res.json()) as AnalyseResponse;
}
