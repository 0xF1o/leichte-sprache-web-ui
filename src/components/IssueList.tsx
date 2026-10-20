import { memo, useMemo } from "react";
import { ruleLabel } from "../lib/llm";
import type { Issue, ViolationStatistics } from "../lib/types";

interface Props {
  issues: Issue[];
  statistics: ViolationStatistics;
}

export const IssueList = memo(function IssueList({ issues, statistics }: Props) {
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
      <div className="rounded-lg border border-green-500/40 bg-green-500/10 p-4 text-green-300">
        Keine Verstöße gefunden. Der Text entspricht den Regeln für Leichte Sprache.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="rounded-full bg-red-500/20 px-3 py-1 text-sm font-semibold text-red-300">
          {statistics.total_violations} Verstöße
        </span>
        {Object.entries(statistics.violations_by_rule).map(([rule, count]) => (
          <span key={rule} className="rounded-full bg-slate-800 px-3 py-1 text-sm text-slate-300">
            {ruleLabel(rule)}: {count}
          </span>
        ))}
      </div>

      <ul className="space-y-2">
        {grouped.map(([ruleId, list]) => (
          <li key={ruleId} className="rounded-lg border border-slate-800 bg-slate-950/60 p-3">
            <p className="mb-2 text-sm font-semibold text-slate-300">
              {ruleLabel(ruleId)} <span className="font-normal text-slate-500">({list.length})</span>
            </p>
            <ul className="space-y-1.5">
              {list.map((issue, i) => (
                <li key={i} className="text-sm text-slate-200">
                  <span className="font-medium text-slate-100">„{issue.text}“</span>{" "}
                  <span className="text-slate-400">– {issue.message}</span>
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ul>
    </div>
  );
});
