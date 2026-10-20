import { useMemo } from "react";

interface Props {
  text: string;
}

interface Part {
  type: "text" | "marker";
  value: string;
  rule?: string;
  message?: string;
}

/**
 * Rendert annotierten Text im Format `Wort[regel: beschreibung]`
 * (Antwort der Analyse-API mit format=annotated_text).
 * Marker werden als kleine Amberglieder mit Tooltip dargestellt.
 */
export function AnnotatedMarkers({ text }: Props) {
  const parts = useMemo<Part[]>(() => {
    const out: Part[] = [];
    let i = 0;
    while (i < text.length) {
      const open = text.indexOf("[", i);
      if (open === -1) {
        out.push({ type: "text", value: text.slice(i) });
        break;
      }
      const close = text.indexOf("]", open);
      if (close === -1) {
        out.push({ type: "text", value: text.slice(i) });
        break;
      }
      if (open > i) out.push({ type: "text", value: text.slice(i, open) });
      const inner = text.slice(open + 1, close);
      const ci = inner.indexOf(":");
      out.push({
        type: "marker",
        value: inner,
        rule: ci >= 0 ? inner.slice(0, ci) : inner,
        message: ci >= 0 ? inner.slice(ci + 1).trim() : "",
      });
      i = close + 1;
    }
    return out;
  }, [text]);

  return (
    <p className="whitespace-pre-wrap text-lg leading-relaxed">
      {parts.map((part, i) =>
        part.type === "marker" ? (
          <mark
            key={i}
            title={`${part.rule}${part.message ? ` – ${part.message}` : ""}`}
            className="mx-0.5 rounded bg-amber-400/30 px-1 align-super text-[0.6em] font-semibold text-amber-100"
          >
            ✗ {part.rule}
          </mark>
        ) : (
          <span key={i}>{part.value}</span>
        ),
      )}
    </p>
  );
}
