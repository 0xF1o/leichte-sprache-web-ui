import { formatSeconds } from "../lib/format";

interface Props {
  seconds: number;
  tokenCount: number;
  /** Bisher empfangener (teilweiser) Antwort-Text */
  fixedText: string;
  copyNote: string | null;
  onCopy: () => void;
  onFixAgain: () => void;
}

/** Hinweis-Panel, wenn die Korrektur abgebrochen wurde. */
export function FixAborted({ seconds, tokenCount, fixedText, copyNote, onCopy, onFixAgain }: Props) {
  return (
    <div className="mt-4 space-y-3">
      <p className="rounded-lg bg-amber-500/10 p-3 text-sm text-amber-200">
        Korrektur nach {formatSeconds(seconds)} abgebrochen
        {tokenCount > 0 && ` (${tokenCount} Tokens erhalten)`}. Der bis dahin empfangene Text ist unten.
      </p>
      {fixedText ? (
        <div>
          <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">Teilweise Antwort des Modells</p>
          <div className="rounded-lg border border-slate-700 bg-slate-950 p-3 font-mono text-sm text-slate-200 whitespace-pre-wrap">{fixedText}</div>
          <button type="button" onClick={onCopy} className="mt-2 rounded-lg border border-slate-700 px-4 py-2 text-slate-300 hover:bg-slate-800">
            Teiltext kopieren
          </button>
          {copyNote && <p className="mt-2 text-sm text-slate-300">{copyNote}</p>}
        </div>
      ) : (
        <p className="text-sm text-slate-500">Es ist noch keine Antwort angekommen – nur Denk-Tokens. Bitte erneut versuchen.</p>
      )}
      <button type="button" onClick={onFixAgain} className="rounded-lg bg-green-600 px-4 py-2 font-semibold text-white hover:bg-green-500">
        Erneut korrigieren
      </button>
    </div>
  );
}
