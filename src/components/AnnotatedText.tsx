import { useMemo } from "react";
import type { Issue } from "../lib/types";

interface Props {
  text: string;
  issues: Issue[];
}

interface Segment {
  content: string;
  highlighted: boolean;
  titles: string[];
}

/**
 * Rendert den Originaltext und markiert die von der Analyse gemeldeten
 * Stellen (über die Start-/End-Positionen).
 */
export function AnnotatedText({ text, issues }: Props) {
  const segments = useMemo<Segment[]>(() => {
    const ranges = issues
      .filter((i) => i.start != null && i.end != null && i.end > i.start && i.start >= 0)
      .map((i) => ({ start: i.start as number, end: i.end as number, issue: i }));
    if (ranges.length === 0) return [{ content: text, highlighted: false, titles: [] }];

    ranges.sort((a, b) => a.start - b.start);
    const merged: { start: number; end: number; issue: Issue }[] = [];
    for (const r of ranges) {
      const last = merged[merged.length - 1];
      if (last && r.start <= last.end) {
        last.end = Math.max(last.end, r.end);
        last.issue = r.issue; // mehrere Regeln möglich – Titel werden pro Range gesammelt
      } else {
        merged.push({ ...r });
      }
    }

    const segs: Segment[] = [];
    let pos = 0;
    for (const m of merged) {
      if (m.start > pos) segs.push({ content: text.slice(pos, m.start), highlighted: false, titles: [] });
      const titles: string[] = [];
      // alle Issues, die diese Range berühren
      for (const r of ranges) {
        if (r.start < m.end && r.end > m.start) {
          titles.push(`[${r.issue.rule_id}] ${r.issue.message}`);
        }
      }
      segs.push({ content: text.slice(m.start, m.end), highlighted: true, titles: [...new Set(titles)] });
      pos = m.end;
    }
    if (pos < text.length) segs.push({ content: text.slice(pos), highlighted: false, titles: [] });
    return segs;
  }, [text, issues]);

  return (
    <p className="whitespace-pre-wrap text-lg leading-relaxed">
      {segments.map((seg, i) =>
        seg.highlighted ? (
          <mark key={i} title={seg.titles.join("\n")} className="rounded bg-amber-200 px-0.5 text-slate-900">
            {seg.content}
          </mark>
        ) : (
          <span key={i}>{seg.content}</span>
        ),
      )}
    </p>
  );
}
