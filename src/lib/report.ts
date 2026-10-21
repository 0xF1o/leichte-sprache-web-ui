import { diffLines } from "diff";
import { violationCount } from "./analyse";
import { ruleLabel } from "./llm";
import type { AnalyseResult, AppSettings, FixRound, ViolationStatistics } from "./types";

export type StopReason = "clean" | "limit" | "error" | "failed" | null;

export interface ReportData {
  /** Originaltext */
  analysedText: string;
  /** Analyse des Originaltextes */
  analysis: AnalyseResult;
  /** Alle Korrektur-Runden */
  rounds: FixRound[];
  /** Einstellungen, mit denen korrigiert wurde */
  settings: AppSettings;
  /** Gesamtdauer der Korrektur in Sekunden */
  totalSeconds: number;
  /** Sekunden bis zum ersten Antwort-Token (null = unbekannt) */
  firstTokenSeconds: number | null;
  /** Tokens gesamt (ca.) */
  totalTokens: number;
  stopReason: StopReason;
}

const STOP_LABELS: Record<Exclude<StopReason, null>, string> = {
  clean: "Ziel erreicht (Toleranz eingehalten)",
  limit: "Rundenlimit erreicht",
  error: "Abbruch durch Fehler",
  failed: "Letzte Runde verworfen (Verschlechterung)",
};

function fmtSeconds(total: number): string {
  const m = Math.floor(total / 60);
  const s = total % 60;
  return m > 0 ? `${m} Min ${s} s` : `${s} s`;
}

/** Aufzählung der Regeln einer Statistik, absteigend nach Anzahl. */
function ruleListLines(stats: ViolationStatistics): string[] {
  return Object.entries(stats.violations_by_rule)
    .sort((a, b) => b[1] - a[1])
    .map(([rule, n]) => `- ${ruleLabel(rule)}: ${n}`);
}

/**
 * Zeilenweises Diff als Markdown-diff-Zeilen (nur + / - Zeilen, ohne Kontext,
 * damit der Bericht lesbar bleibt).
 */
function diffLinesMarkdown(before: string, after: string): string[] {
  const changed = diffLines(before, after).filter((p) => p.added || p.removed);
  if (changed.length === 0) return ["(keine Änderung)"];
  return changed.flatMap((p) =>
    p.value
      .replace(/\n$/, "")
      .split("\n")
      .map((line) => `${p.added ? "+" : "-"} ${line}`),
  );
}

/**
 * Erzeugt den Markdown-Bericht der Korrektur: Einstellungen, Modell,
 * Zusammenfassung je Runde (Verstöße, Zeit, Tokens, Status), Regel-Details,
 * Änderungen je Runde sowie Original- und Finaltext.
 * Bewusst NICHT enthalten: System-/Nutzer-Prompts und das Regelwerk selbst.
 */
export function buildReportMarkdown(d: ReportData): string {
  const lastAccepted = [...d.rounds].reverse().find((r) => r.accepted) ?? null;
  const finalText = lastAccepted ? lastAccepted.text : d.analysedText;
  const finalAnalysis = lastAccepted?.analysis ?? null;
  const originalCount = violationCount(d.analysis);
  const finalCount = violationCount(finalAnalysis);

  const L: string[] = [];
  L.push("# Leichte Sprache – Korrektur-Bericht");
  L.push("");
  L.push(`Erstellt: ${new Date().toLocaleString("de-DE")}`);
  L.push("");

  L.push("## Einstellungen");
  L.push("");
  L.push(`- Modell: ${d.settings.model || "(nicht gesetzt)"}`);
  if (d.settings.baseUrl) L.push(`- Modell-Basis-URL: ${d.settings.baseUrl}`);
  if (d.settings.reasoningEffort) L.push(`- Reasoning: ${d.settings.reasoningEffort}`);
  L.push(`- Analyse-API: ${d.settings.analyseUrl}`);
  L.push(`- Max. Runden: ${d.settings.fixRounds}, Toleranz: ${d.settings.tolerance} Verstöße`);
  L.push(`- Ergebnis: ${d.stopReason ? STOP_LABELS[d.stopReason] : "–"}`);
  L.push(
    `- Gesamtdauer: ${fmtSeconds(d.totalSeconds)} · Tokens gesamt (ca.): ${d.totalTokens}` +
      (d.firstTokenSeconds != null ? ` · erstes Token nach ${fmtSeconds(d.firstTokenSeconds)}` : ""),
  );
  L.push("");

  L.push("## Zusammenfassung");
  L.push("");
  L.push("| Runde | Verstöße | Veränderung | Zeit | Tokens | Status |");
  L.push("| --- | --- | --- | --- | --- | --- |");
  L.push(`| Original | ${originalCount ?? "–"} | – | – | – | – |`);
  // „Veränderung" bezieht sich immer auf den zuletzt ÜBERNOHMENEN Stand
  let baseline: number | null = originalCount;
  for (const r of d.rounds) {
    const c = violationCount(r.analysis);
    const delta =
      c != null && baseline != null ? (c - baseline === 0 ? "0" : c - baseline > 0 ? `+${c - baseline}` : `${c - baseline}`) : "–";
    L.push(
      `| Runde ${r.round} | ${c ?? "–"} | ${delta} | ${fmtSeconds(r.seconds)} | ${r.tokens} | ${
        r.accepted ? "angenommen" : "✗ verworfen"
      } |`,
    );
    if (r.accepted && c != null) baseline = c;
  }
  L.push("");
  L.push(
    `Verstöße gesamt: ${originalCount ?? "–"} (Original) → ${finalCount ?? "–"} ` +
      `(letzte übernommene Version${lastAccepted ? `, Runde ${lastAccepted.round}` : ", Original"}).`,
  );

  if (d.analysis.statistics && finalAnalysis?.statistics) {
    L.push("");
    L.push("## Vorher / Nachher nach Regeln");
    L.push("");
    L.push("| Regel | Vorher | Nachher |");
    L.push("| --- | --- | --- |");
    const rules = [
      ...new Set([...Object.keys(d.analysis.statistics.violations_by_rule), ...Object.keys(finalAnalysis.statistics.violations_by_rule)]),
    ];
    for (const rule of rules) {
      const bv = d.analysis.statistics.violations_by_rule[rule] ?? 0;
      const av = finalAnalysis.statistics.violations_by_rule[rule] ?? 0;
      L.push(`| ${ruleLabel(rule)} | ${bv} | ${av} |`);
    }
  }

  for (const r of d.rounds) {
    const idx = d.rounds.indexOf(r);
    const prevAccepted = d.rounds.slice(0, idx).reverse().find((x) => x.accepted) ?? null;
    const c = violationCount(r.analysis);
    L.push("");
    L.push(`## Runde ${r.round}${r.accepted ? "" : " (verworfen)"}`);
    L.push("");
    L.push(`- Zeit: ${fmtSeconds(r.seconds)} · Tokens (ca.): ${r.tokens}`);
    L.push(`- Verstöße: ${c ?? "keine Prüfung möglich"}`);
    if (r.analysis?.statistics) {
      L.push("- Regeln:");
      for (const line of ruleListLines(r.analysis.statistics)) L.push(`  ${line}`);
    }
    L.push(`- Änderungen gegenüber ${prevAccepted ? `Runde ${prevAccepted.round}` : "dem Original"}:`);
    L.push("");
    L.push("```diff");
    L.push(...diffLinesMarkdown(prevAccepted ? prevAccepted.text : d.analysedText, r.text));
    L.push("```");
  }

  L.push("");
  L.push("## Original");
  L.push("");
  L.push(d.analysedText);
  L.push("");
  L.push(`## Finaler Text${lastAccepted ? ` (Runde ${lastAccepted.round})` : " (Original – keine Runde übernommen)"}`);
  L.push("");
  L.push(finalText);
  L.push("");
  return L.join("\n");
}

/** Dateiname für den Bericht, z. B. leichte-sprache-bericht-2025-01-30-14-05.md */
export function reportFilename(date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `leichte-sprache-bericht-${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}-${p(date.getHours())}-${p(date.getMinutes())}.md`;
}

/** Markdown-Inhalt als Datei herunterladen. */
export function downloadMarkdown(filename: string, content: string): void {
  const blob = new Blob([content], { type: "text/markdown;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
