import { DEFAULT_ANALYSE_URL } from "./analyse";
import type { AppSettings } from "./types";

const STORAGE_KEY = "lswui.llmsettings";

export const REASONING_EFFORTS: readonly string[] = ["", "minimal", "low", "medium", "high", "xhigh"];

/** Zahl auf ganzzahligen Wert im Bereich begrenzen (Standard bei ungültigem Input). */
export function clampInt(v: number | undefined, min: number, max: number, dflt: number): number {
  const n = typeof v === "number" && Number.isFinite(v) ? Math.floor(v) : dflt;
  return Math.max(min, Math.min(max, n));
}

/**
 * Validiert die in localStorage gespeicherten Einstellungen (unbekannter
 * Ursprung) und gibt nur Felder zurück, die den erwarteten Typen entsprechen.
 */
function sanitizeStored(raw: unknown): Partial<AppSettings> {
  if (!raw || typeof raw !== "object") return {};
  const o = raw as Record<string, unknown>;
  const str = (k: string): string | undefined => (typeof o[k] === "string" ? (o[k] as string) : undefined);
  const out: Partial<AppSettings> = {};
  const a = str("analyseUrl");
  if (a !== undefined) out.analyseUrl = a;
  const b = str("baseUrl");
  if (b !== undefined) out.baseUrl = b;
  const m = str("model");
  if (m !== undefined) out.model = m;
  const k = str("apiKey");
  if (k !== undefined) out.apiKey = k;
  const r = str("reasoningEffort");
  if (r !== undefined) out.reasoningEffort = REASONING_EFFORTS.includes(r) ? (r as AppSettings["reasoningEffort"]) : "";
  if (typeof o.fixRounds === "number") out.fixRounds = clampInt(o.fixRounds, 1, 10, 3);
  if (typeof o.tolerance === "number") out.tolerance = clampInt(o.tolerance, 0, 999, 0);
  return out;
}

export function defaultSettings(): AppSettings {
  let stored: Partial<AppSettings> = {};
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    stored = raw ? sanitizeStored(JSON.parse(raw)) : {};
  } catch {
    /* ignore */
  }
  // Bewusst „??“, nicht „||“: ein bewusst geleertes Feld (z. B. "") bleibt leer,
  // statt still zurück auf den Build-Zeit-Wert zu fallen.
  return {
    analyseUrl: stored.analyseUrl ?? import.meta.env.LSWUI_ANALYSE_URL ?? DEFAULT_ANALYSE_URL,
    baseUrl: stored.baseUrl ?? import.meta.env.LSWUI_BASE_URL ?? "",
    model: stored.model ?? import.meta.env.LSWUI_MODEL ?? "",
    apiKey: stored.apiKey ?? import.meta.env.LSWUI_API_KEY ?? "",
    reasoningEffort: stored.reasoningEffort ?? "",
    fixRounds: stored.fixRounds ?? 3,
    tolerance: stored.tolerance ?? 0,
  };
}
