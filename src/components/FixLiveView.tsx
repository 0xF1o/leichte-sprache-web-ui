import type { RefObject } from "react";
import type { AnalyseResult, FixRound } from "../lib/types";
import { LiveRounds } from "./LiveRounds";

interface Props {
  analysis: AnalyseResult;
  rounds: FixRound[];
  runningRound: number | null;
  maxRounds: number;
  runningLabel: string;
  runningMeta: string;
  tolerance: number;
  thinkingText: string;
  fixedText: string;
  /** Refs der App: Panes werden beim Wachstum automatisch ans Ende gescrollt */
  livePaneRef: RefObject<HTMLDivElement | null>;
  thinkingPaneRef: RefObject<HTMLDivElement | null>;
}

/** Live-Ansicht während der Korrektur: Runden-Status, Thinking und Antwort tokenweise. */
export function FixLiveView({
  analysis,
  rounds,
  runningRound,
  maxRounds,
  runningLabel,
  runningMeta,
  tolerance,
  thinkingText,
  fixedText,
  livePaneRef,
  thinkingPaneRef,
}: Props) {
  return (
    <div className="mt-4 space-y-3">
      {/* Live-Bericht: fertige Runden erscheinen, sobald ihre Prüfung da ist;
          die laufende Runde trägt den Status (Runde x/y, Phase, Laufzeit) */}
      <div className="rounded-lg border border-slate-800 bg-slate-950 p-3">
        <LiveRounds
          analysis={analysis}
          rounds={rounds}
          runningRound={runningRound}
          maxRounds={maxRounds}
          runningLabel={runningLabel}
          runningMeta={runningMeta}
          tolerance={tolerance}
        />
      </div>

      {thinkingText && (
        <div>
          <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-amber-400">
            Das Modell denkt (Thinking) – das kann einige Minuten dauern
          </p>
          <div
            ref={thinkingPaneRef}
            className="h-40 overflow-y-auto rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 font-mono text-sm text-amber-200"
          >
            <span className="whitespace-pre-wrap">{thinkingText}</span>
            <span className="ml-0.5 inline-block h-4 w-2 animate-pulse bg-amber-300 align-middle" />
          </div>
        </div>
      )}

      <div>
        <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">Antwort des Modells</p>
        <div
          ref={livePaneRef}
          className="h-40 overflow-y-auto rounded-lg border border-slate-800 bg-slate-950 p-3 font-mono text-sm text-slate-100"
        >
          {fixedText ? (
            <>
              <span className="whitespace-pre-wrap">{fixedText}</span>
              <span className="ml-0.5 inline-block h-4 w-2 animate-pulse bg-slate-100 align-middle" />
            </>
          ) : (
            <span className="text-slate-500">
              {thinkingText
                ? "Das Modell denkt noch – die Antwort erscheint hier, sobald sie geschrieben wird."
                : "Hier erscheint die Antwort tokenweise, sobald das Modell zu schreiben beginnt."}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
