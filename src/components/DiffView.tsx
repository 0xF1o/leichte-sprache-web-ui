import { memo, useMemo } from "react";
import { diffWords } from "diff";

interface Props {
  original: string;
  corrected: string;
}

/** Wort-Diff: Gelösches wird rot durchgestrichen, Neues grün hervorgehoben. */
export const DiffView = memo(function DiffView({ original, corrected }: Props) {
  const parts = useMemo(() => diffWords(original, corrected), [original, corrected]);

  return (
    <div className="whitespace-pre-wrap text-lg leading-relaxed">
      {parts.map((part, i) => {
        if (part.added) {
          return (
            <ins key={i} className="rounded bg-green-500/25 px-0.5 text-green-300 no-underline">
              {part.value}
            </ins>
          );
        }
        if (part.removed) {
          return (
            <del key={i} className="rounded bg-red-500/25 px-0.5 text-red-300">
              {part.value}
            </del>
          );
        }
        return <span key={i}>{part.value}</span>;
      })}
    </div>
  );
});
