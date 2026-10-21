import { memo, type ReactNode } from "react";
import { violationCount } from "../lib/analyse";
import { ruleLabel } from "../lib/llm";
import type { AnalyseResult, FixRound } from "../lib/types";
import { FixedResult } from "./FixedResult";
import { RoundsReport } from "./RoundsReport";

function formatSeconds(total: number): string {
  const m = Math.floor(total / 60);
  const s = total % 60;
  return m > 0 ? `${m} Min ${s} s` : `${s} s`;
}

/** Anzahl-Unterschied nach der Korrektur (negativ = weniger Probleme). null = nicht vergleichbar. */
function countDelta(before: AnalyseResult, after: AnalyseResult): number | null {
  const b = violationCount(before);
  const a = violationCount(after);
  return b != null && a != null ? a - b : null;
}

/** Vorher/Nachher-Vergleich (Gesamtzahl + Aufschlüsselung nach Regeln). */
function RecheckReport({ before, after }: { before: AnalyseResult; after: AnalyseResult }) {
  const delta = countDelta(before, after);

  if (before.statistics && after.statistics && delta != null) {
    const b = before.statistics;
    const a = after.statistics;
    const rules = [...new Set([...Object.keys(b.violations_by_rule), ...Object.keys(a.violations_by_rule)])];
    return (
      <div className="space-y-2">
        <p className="text-sm">
          {delta < 0 ? (
            <span className="font-semibold text-green-400">
              {b.total_violations} → {a.total_violations} Verstöße ({-delta} weniger)
            </span>
          ) : delta === 0 ? (
            <span className="font-semibold text-slate-300">{a.total_violations} Verstöße – Anzahl gleich geblieben</span>
          ) : (
            <span className="font-semibold text-red-400">
              {b.total_violations} → {a.total_violations} Verstöße ({delta} mehr)
            </span>
          )}
        </p>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-slate-500">
              <th className="py-1 font-medium">Regel</th>
              <th className="font-medium">Vorher</th>
              <th className="font-medium">Nachher</th>
            </tr>
          </thead>
          <tbody>
            {rules.map((r) => {
              const bv = b.violations_by_rule[r] ?? 0;
              const av = a.violations_by_rule[r] ?? 0;
              return (
                <tr key={r} className="border-t border-slate-800">
                  <td className="py-1 text-slate-300">{ruleLabel(r)}</td>
                  <td className="text-slate-400">{bv}</td>
                  <td className={av < bv ? "text-green-400" : av > bv ? "text-red-400" : "text-slate-300"}>{av}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {a.total_violations === 0 && <p className="text-sm font-medium text-green-400">Alle Verstöße behoben. 🎉</p>}
      </div>
    );
  }

  // annotated_text-Modus: Markierungen zählen
  const b = violationCount(before);
  const a = violationCount(after);
  if (b == null || a == null || delta == null) return null;
  return (
    <p className="text-sm">
      {delta < 0 ? (
        <span className="font-semibold text-green-400">
          Markierte Stellen: {b} → {a} ({-delta} weniger)
        </span>
      ) : delta === 0 ? (
        <span className="font-semibold text-slate-300">Markierte Stellen: {a} – Anzahl gleich geblieben</span>
      ) : (
        <span className="font-semibold text-red-400">
          Markierte Stellen: {b} → {a} ({delta} mehr)
        </span>
      )}
    </p>
  );
}

/** Auswahl-Button für eine Text-Version im Vergleich (Original / Runde n). */
function VersionButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={
        active
          ? "rounded-md bg-blue-600 px-3 py-1 text-sm font-semibold text-white"
          : "rounded-md border border-slate-700 px-3 py-1 text-sm text-slate-300 hover:bg-slate-800"
      }
    >
      {children}
    </button>
  );
}

interface Props {
  /** Analyse des Originaltextes */
  analysis: AnalyseResult;
  /** Originaltext (Version 0) */
  analysedText: string;
  /** Alle abgeschlossenen Korrektur-Runden */
  fixRoundList: FixRound[];
  /** Stop-Grund: "clean" = Toleranz erreicht, "limit" = Rundenlimit, "error" = Abbruch durch Fehler */
  fixStopReason: "clean" | "limit" | "error" | null;
  fixMaxRounds: number;
  tolerance: number;
  fixSeconds: number;
  firstTokenSeconds: number | null;
  tokenCount: number;
  fixWarning: string | null;
  /** Angezeigte Version: 0 = Original, n = Runde n, -1 = Original vs. letzte Runde */
  shownVersion: number;
  onSelVersion: (v: number) => void;
  copyNote: string | null;
  onUseFixed: () => void;
  onCopy: () => void;
  onFixAgain: () => void;
}

/**
 * Ergebnis-Ansicht nach der Mehr-Runden-Korrektur: Bericht (Verstöße pro
 * Runde, Vorher/Nachher) und der Versions-Vergleich (Original / Runde n).
 */
export const FixedReport = memo(function FixedReport({
  analysis,
  analysedText,
  fixRoundList,
  fixStopReason,
  fixMaxRounds,
  tolerance,
  fixSeconds,
  firstTokenSeconds,
  tokenCount,
  fixWarning,
  shownVersion,
  onSelVersion,
  copyNote,
  onUseFixed,
  onCopy,
  onFixAgain,
}: Props) {
  const lastRound = fixRoundList[fixRoundList.length - 1];
  const finalCount = violationCount(lastRound?.analysis ?? null);

  return (
    <div className="mt-4 space-y-4">
      <p className="text-sm text-slate-400">
        Fertig nach {formatSeconds(fixSeconds)} · {fixRoundList.length}{" "}
        {fixRoundList.length === 1 ? "Runde" : "Runden"}
        {firstTokenSeconds != null && <> (die erste Antwort kam erst nach {formatSeconds(firstTokenSeconds)})</>}.
        {" "}Tokens (ca.): {tokenCount}
      </p>
      {fixStopReason === "clean" && (
        <p className="text-sm font-medium text-green-400">
          Ziel erreicht: {finalCount ?? "?"} Verstöße übrig (Toleranz: {tolerance}). 🎉
        </p>
      )}
      {fixStopReason === "limit" && (
        <p className="text-sm text-amber-300">
          Maximale Rundenzahl ({fixMaxRounds}) erreicht. Letzter Stand: {finalCount ?? "keine Prüfung möglich"}{" "}
          Verstöße (Toleranz: {tolerance}).
        </p>
      )}
      {fixWarning && <p className="rounded-lg bg-amber-500/10 p-3 text-sm text-amber-200">{fixWarning}</p>}

      {fixRoundList.length > 0 && (
        <div className="rounded-lg border border-slate-800 bg-slate-950 p-4">
          <RoundsReport
            tolerance={tolerance}
            rounds={[
              { label: "Original", analysis, seconds: null, tokens: null },
              ...fixRoundList.map((r) => ({
                label: `Runde ${r.round}`,
                analysis: r.analysis,
                seconds: r.seconds,
                tokens: r.tokens,
              })),
            ]}
          />
          {lastRound?.analysis && (
            <div className="mt-4 border-t border-slate-800 pt-3">
              <h3 className="mb-2 font-semibold">Vorher / Nachher (Regel-Details)</h3>
              <RecheckReport before={analysis} after={lastRound.analysis} />
            </div>
          )}
        </div>
      )}

      <div className="rounded-lg border border-slate-800 bg-slate-950 p-4">
        <div className="mb-3 flex flex-wrap gap-2" role="group" aria-label="Version wählen">
          <VersionButton active={shownVersion === 0} onClick={() => onSelVersion(0)}>
            Original
          </VersionButton>
          {fixRoundList.map((r) => (
            <VersionButton key={r.round} active={shownVersion === r.round} onClick={() => onSelVersion(r.round)}>
              Runde {r.round}
            </VersionButton>
          ))}
          {lastRound && (
            <VersionButton active={shownVersion === -1} onClick={() => onSelVersion(-1)}>
              Original → Runde {lastRound.round}
            </VersionButton>
          )}
        </div>
        {shownVersion === 0 ? (
          <div className="whitespace-pre-wrap text-lg leading-relaxed">{analysedText}</div>
        ) : shownVersion === -1 && lastRound ? (
          <FixedResult key="original-final" original={analysedText} corrected={lastRound.text} />
        ) : (
          <FixedResult
            key={shownVersion}
            original={shownVersion === 1 ? analysedText : fixRoundList[shownVersion - 2].text}
            corrected={fixRoundList[shownVersion - 1].text}
          />
        )}
        <p className="mt-3 text-xs text-slate-500">
          Ansicht je Version umschalten: Änderungen (gegenüber der vorherigen Version, „Original → Runde n“ zeigt den
          Gesamtvorher-Nachher-Vergleich), Vorher, Nachher.
        </p>
      </div>

      {copyNote && <p className="text-sm text-slate-300">{copyNote}</p>}

      <div className="flex flex-wrap gap-3">
        <button
          type="button"
          onClick={onUseFixed}
          className="rounded-lg bg-blue-600 px-4 py-2 font-semibold text-white hover:bg-blue-700"
        >
          Korrektur neu analysieren
        </button>
        <button
          type="button"
          onClick={onCopy}
          className="rounded-lg border border-slate-700 px-4 py-2 text-slate-300 hover:bg-slate-800"
        >
          Korrigierten Text kopieren
        </button>
        <button
          type="button"
          onClick={onFixAgain}
          className="rounded-lg border border-slate-700 px-4 py-2 text-slate-300 hover:bg-slate-800"
        >
          Erneut korrigieren
        </button>
      </div>
    </div>
  );
});
