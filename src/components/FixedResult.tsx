import { memo, useState } from "react";
import { DiffView } from "./DiffView";

interface Props {
  original: string;
  corrected: string;
}

type View = "diff" | "old" | "new";

const VIEWS: { id: View; label: string }[] = [
  { id: "diff", label: "Änderungen" },
  { id: "old", label: "Vorher" },
  { id: "new", label: "Nachher" },
];

/**
 * Ergebnis-Ansicht nach der KI-Korrektur: Umschaltbar zwischen Wort-Diff,
 * dem Originaltext und dem korrigierten Text (Standard: Diff).
 */
export const FixedResult = memo(function FixedResult({ original, corrected }: Props) {
  const [view, setView] = useState<View>("diff");

  return (
    <div>
      <div role="group" aria-label="Ansicht wählen" className="mb-3 inline-flex rounded-lg border border-slate-700 p-0.5">
        {VIEWS.map((v) => (
          <button
            key={v.id}
            type="button"
            aria-pressed={view === v.id}
            onClick={() => setView(v.id)}
            className={
              view === v.id
                ? "rounded-md bg-blue-600 px-3 py-1 text-sm font-semibold text-white"
                : "rounded-md px-3 py-1 text-sm text-slate-300 hover:bg-slate-800"
            }
          >
            {v.label}
          </button>
        ))}
      </div>
      {view === "diff" ? (
        <DiffView original={original} corrected={corrected} />
      ) : (
        <div className="whitespace-pre-wrap text-lg leading-relaxed">{view === "old" ? original : corrected}</div>
      )}
    </div>
  );
});
