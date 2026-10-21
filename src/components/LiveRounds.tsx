import { violationCount } from "../lib/analyse";
import type { AnalyseResult, FixRound } from "../lib/types";

function fmtSeconds(total: number): string {
  const m = Math.floor(total / 60);
  const s = total % 60;
  return m > 0 ? `${m} Min ${s} s` : `${s} s`;
}

interface Props {
  /** Analyse des Originaltextes */
  analysis: AnalyseResult;
  /** Fertige Korrektur-Runden */
  rounds: FixRound[];
  /** Nummer der gerade laufenden Runde (null = keine) */
  runningRound: number | null;
  /** Maximale Rundenzahl (für „Runde 4/10“) */
  maxRounds: number;
  /** Aktueller Status-Text der laufenden Runde, z. B. „Modell denkt gerade …“ */
  runningLabel: string;
  /** Meta-Infos der laufenden Runde, z. B. „Laufzeit: 12 s · 340 Tokens“ */
  runningMeta: string | null;
  tolerance: number;
}

/**
 * Kompakte Live-Liste während der Korrektur: je Runde eine Zeile mit
 * Status (✓/✗), Verstößen, Veränderung und Meta-Infos. Läuft deutlich
 * schlanker als die volle Berichtstabelle.
 */
export function LiveRounds({ analysis, rounds, runningRound, maxRounds, runningLabel, runningMeta, tolerance }: Props) {
  const originalCount = violationCount(analysis);
  // „Veränderung" bezieht sich immer auf den zuletzt ÜBERNOHMENEN Stand
  let baseline = originalCount;
  const items = rounds.map((r) => {
    const count = violationCount(r.analysis);
    const delta = count != null && baseline != null ? count - baseline : null;
    if (r.accepted && count != null) baseline = count;
    return { r, count, delta };
  });

  return (
    <ul className="space-y-1.5">
      <li className="flex items-center justify-between rounded-lg bg-slate-900/60 px-3 py-1.5 text-sm">
        <span className="text-slate-400">Original</span>
        <span className="font-medium text-slate-200">{originalCount ?? "–"} Verstöße</span>
      </li>
      {items.map(({ r, count, delta }) => (
        <li
          key={r.round}
          className={`flex items-center gap-3 rounded-lg border px-3 py-1.5 ${
            r.accepted ? "border-slate-800 bg-slate-900/60" : "border-red-500/40 bg-red-950/20"
          }`}
        >
          <span
            className={`w-4 shrink-0 text-center text-sm font-bold ${r.accepted ? "text-green-400" : "text-red-400"}`}
            aria-hidden
          >
            {r.accepted ? "✓" : "✗"}
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-sm text-slate-200">
              Runde {r.round}
              {!r.accepted && <span className="ml-2 text-xs text-red-400">verworfen</span>}
            </p>
            <p className="text-xs text-slate-500">
              {fmtSeconds(r.seconds)} · {r.tokens} Tokens
            </p>
          </div>
          <div className="text-right">
            <p className={`text-sm font-semibold ${count != null && count > tolerance ? "text-red-300" : "text-green-400"}`}>
              {count ?? "–"} Verstöße
            </p>
            {delta != null && (
              <p className={`text-xs ${delta < 0 ? "text-green-400" : delta > 0 ? "text-red-400" : "text-slate-500"}`}>
                {delta === 0 ? "gleiche Anzahl" : delta > 0 ? `+${delta} gegenüber vorher` : `${delta} gegenüber vorher`}
              </p>
            )}
          </div>
        </li>
      ))}
      {runningRound != null && (
        <li className="flex items-center gap-3 rounded-lg border border-slate-800 bg-slate-900/40 px-3 py-1.5">
          <span
            className="inline-block h-3.5 w-3.5 shrink-0 animate-spin rounded-full border-2 border-slate-400 border-t-transparent"
            aria-hidden
          />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm text-slate-200">
              Runde {runningRound}/{maxRounds} · {runningLabel}
            </p>
            {runningMeta && <p className="truncate text-xs text-slate-500">{runningMeta}</p>}
          </div>
        </li>
      )}
    </ul>
  );
}
