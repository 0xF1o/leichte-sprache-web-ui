import { useMemo } from "react";
import type { Issue, ViolationStatistics } from "../lib/types";

interface Props {
  issues: Issue[];
  statistics: ViolationStatistics;
}

const RULE_LABELS: Record<string, string> = {
  regel_fremdwoerter: "Fremdwörter",
  regel_satzlaenge: "Satzlänge",
  regel_passiv: "Passiv",
  regel_groesse: "Textlänge",
  regel_konjunktiv: "Konjunktiv",
};

function ruleLabel(ruleId: string): string {
  const base = ruleId.replace(/_issue$/, "");
  return RULE_LABELS[base] ?? base;
}

export function IssueList({ issues, statistics }: Props) {
  const grouped = useMemo(() => {
    const map = new Map<string, Issue[]>();
    for (const issue of issues) {
      const list = map.get(issue.rule_id) ?? [];
      list.push(issue);
      map.set(issue.rule_id, list);
    }
    return [...map.entries()];
  }, [issues]);

  if (issues.length === 0) {
    return (
      <div className="rounded-lg border border-green-300 bg-green-50 p-4 text-green-900">
        Keine Verstöße gefunden. Der Text entspricht den Regeln für Leichte Sprache.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="rounded-full bg-red-100 px-3 py-1 text-sm font-semibold text-red-800">
          {statistics.total_violations} Verstöße
        </span>
        {Object.entries(statistics.violations_by_rule).map(([rule, count]) => (
          <span key={rule} className="rounded-full bg-slate-200 px-3 py-1 text-sm text-slate-700">
            {ruleLabel(rule)}: {count}
          </span>
        ))}
      </div>

      <ul className="space-y-2">
        {grouped.map(([ruleId, list]) => (
          <li key={ruleId} className="rounded-lg border border-slate-200 bg-white p-3">
            <p className="mb-2 text-sm font-semibold text-slate-700">
              {ruleLabel(ruleId)} <span className="font-normal text-slate-500">({list.length})</span>
            </p>
            <ul className="space-y-1.5">
              {list.map((issue, i) => (
                <li key={i} className="text-sm text-slate-800">
                  <span className="font-medium text-slate-900">„{issue.text}“</span>{" "}
                  <span className="text-slate-600">– {issue.message}</span>
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ul>
    </div>
  );
}
