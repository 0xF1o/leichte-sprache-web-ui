import { violationCount } from "../lib/analyse";
import type { AnalyseResult, FixRound } from "../lib/types";

export interface RoundEntry {
  label: string;
  analysis: AnalyseResult | null;
  /** Dauer der Runde in Sekunden (null = nicht gemessen, z. B. Original) */
  seconds: number | null;
  /** Tokens der Runde (null = nicht gemessen) */
  tokens: number | null;
  /** true = Runde verworfen (Verschlechterung / fehlgeschlagene Prüfung) */
  failed: boolean;
}

/** Zeilen für den Bericht: Original + alle Korrektur-Runden. */
export function roundEntries(analysis: AnalyseResult, rounds: FixRound[]): RoundEntry[] {
  return [
    { label: "Original", analysis, seconds: null, tokens: null, failed: false },
    ...rounds.map((r) => ({
      label: `Runde ${r.round}`,
      analysis: r.analysis,
      seconds: r.seconds,
      tokens: r.tokens,
      failed: !r.accepted,
    })),
  ];
}

function formatSeconds(total: number): string {
  const m = Math.floor(total / 60);
  const s = total % 60;
  return m > 0 ? `${m} Min ${s} s` : `${s} s`;
}

/** Bericht: Anzahl der Verstöße, Zeit und Tokens je Runde (Original + alle Korrektur-Runden). */
export function RoundsReport({ rounds, tolerance }: { rounds: RoundEntry[]; tolerance: number }) {
  return (
    <div>
      <h3 className="mb-2 font-semibold">Verstöße pro Runde</h3>
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-slate-500">
            <th className="py-1 font-medium">Runde</th>
            <th className="font-medium">Verstöße</th>
            <th className="font-medium">Veränderung</th>
            <th className="font-medium">Zeit</th>
            <th className="font-medium">Tokens</th>
          </tr>
        </thead>
        <tbody>
          {rounds.map((r, i) => {
            const c = violationCount(r.analysis);
            const prev = i > 0 ? violationCount(rounds[i - 1].analysis) : null;
            const d = c != null && prev != null ? c - prev : null;
            return (
              <tr key={r.label} className={`border-t border-slate-800 ${r.failed ? "bg-red-950/30" : ""}`}>
                <td className="py-1 text-slate-300">
                  {r.label}
                  {r.failed && <span className="ml-2 text-xs font-semibold text-red-400">✗ verworfen</span>}
                </td>
                <td className={c != null && c > tolerance ? "text-red-300" : "text-slate-300"}>{c ?? "–"}</td>
                <td
                  className={
                    d == null ? "text-slate-500" : d < 0 ? "text-green-400" : d > 0 ? "text-red-400" : "text-slate-500"
                  }
                >
                  {d == null ? "–" : d === 0 ? "0" : d > 0 ? `+${d}` : `${d}`}
                </td>
                <td className="text-slate-400">{r.seconds != null ? formatSeconds(r.seconds) : "–"}</td>
                <td className="text-slate-400">{r.tokens != null ? r.tokens : "–"}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="mt-2 text-xs text-slate-500">Toleranz: {tolerance} erlaubte restliche Verstöße.</p>
    </div>
  );
}
