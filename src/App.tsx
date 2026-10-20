import { useEffect, useRef, useState } from "react";
import { DEFAULT_ANALYSE_URL, analyseText } from "./lib/analyse";
import { buildFixMessages, cleanModelOutput, runFixSession, streamChat, type ChatMessage } from "./lib/llm";
import type { AnalyseResult, AppSettings } from "./lib/types";
import { AnnotatedText } from "./components/AnnotatedText";
import { AnnotatedMarkers } from "./components/AnnotatedMarkers";
import { IssueList } from "./components/IssueList";
import { DiffView } from "./components/DiffView";
import { SettingsPanel } from "./components/SettingsPanel";

const STORAGE_KEY = "lswui.llmsettings";
const BASE_TITLE = "Leichte Sprache – Text prüfen und verbessern";
const MAX_ROUNDS = 3;

type Stage = "idle" | "analysing" | "results" | "fixing" | "fixed";

function defaultSettings(): AppSettings {
  let stored: AppSettings | null = null;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    stored = raw ? (JSON.parse(raw) as AppSettings) : null;
  } catch {
    /* ignore */
  }
  return {
    analyseUrl: stored?.analyseUrl || import.meta.env.LSWUI_ANALYSE_URL || DEFAULT_ANALYSE_URL,
    baseUrl: stored?.baseUrl || import.meta.env.LSWUI_BASE_URL || "",
    model: stored?.model || import.meta.env.LSWUI_MODEL || "",
    apiKey: stored?.apiKey || import.meta.env.LSWUI_API_KEY || "",
    reasoningEffort: stored?.reasoningEffort || "",
    selfCheck: stored?.selfCheck ?? false,
  };
}

function Spinner() {
  return <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent align-middle" />;
}

function formatSeconds(total: number): string {
  const m = Math.floor(total / 60);
  const s = total % 60;
  return m > 0 ? `${m} Min ${s} s` : `${s} s`;
}

/** Anzahl-Unterschied nach der Korrektur (negativ = weniger Probleme). null = nicht vergleichbar. */
function countDelta(before: AnalyseResult, after: AnalyseResult): number | null {
  if (before.statistics && after.statistics) {
    return after.statistics.total_violations - before.statistics.total_violations;
  }
  const count = (s: string) => (s.match(/\[[^\[\]]+\]/g) ?? []).length;
  return count(after.annotatedText) - count(before.annotatedText);
}

function RecheckReport({ before, after }: { before: AnalyseResult; after: AnalyseResult }) {
  const delta = countDelta(before, after);

  if (before.statistics && after.statistics && delta != null) {
    const b = before.statistics;
    const a = after.statistics;
    const rules = [...new Set([...Object.keys(b.violations_by_rule), ...Object.keys(a.violations_by_rule)])];
    return (
      <div className="space-y-2">
        <p className="text-sm">
          {delta < 0 ? (
            <span className="font-semibold text-green-400">
              {b.total_violations} → {a.total_violations} Verstöße ({-delta} weniger)
            </span>
          ) : delta === 0 ? (
            <span className="font-semibold text-slate-300">{a.total_violations} Verstöße – Anzahl gleich geblieben</span>
          ) : (
            <span className="font-semibold text-red-400">
              {b.total_violations} → {a.total_violations} Verstöße ({delta} mehr)
            </span>
          )}
        </p>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-slate-500">
              <th className="py-1 font-medium">Regel</th>
              <th className="font-medium">Vorher</th>
              <th className="font-medium">Nachher</th>
            </tr>
          </thead>
          <tbody>
            {rules.map((r) => {
              const bv = b.violations_by_rule[r] ?? 0;
              const av = a.violations_by_rule[r] ?? 0;
              return (
                <tr key={r} className="border-t border-slate-800">
                  <td className="py-1 text-slate-300">{r.replace(/_issue$/, "")}</td>
                  <td className="text-slate-400">{bv}</td>
                  <td className={av < bv ? "text-green-400" : av > bv ? "text-red-400" : "text-slate-300"}>{av}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {a.total_violations === 0 && <p className="text-sm font-medium text-green-400">Alle Verstöße behoben. 🎉</p>}
      </div>
    );
  }

  // annotated_text-Modus: Markierungen zählen
  const count = (s: string) => (s.match(/\[[^\[\]]+\]/g) ?? []).length;
  const b = count(before.annotatedText);
  const a = count(after.annotatedText);
  const d = a - b;
  return (
    <p className="text-sm">
      {d < 0 ? (
        <span className="font-semibold text-green-400">
          Markierte Stellen: {b} → {a} ({-d} weniger)
        </span>
      ) : d === 0 ? (
        <span className="font-semibold text-slate-300">Markierte Stellen: {a} – Anzahl gleich geblieben</span>
      ) : (
        <span className="font-semibold text-red-400">
          Markierte Stellen: {b} → {a} ({d} mehr)
        </span>
      )}
    </p>
  );
}

export default function App() {
  const [text, setText] = useState("");
  const [settings, setSettings] = useState<AppSettings>(defaultSettings);

  const [stage, setStage] = useState<Stage>("idle");
  const [analysis, setAnalysis] = useState<AnalyseResult | null>(null);
  /** true, wenn die Analyse nur den annotierten Text liefert (format=annotated_text) */
  const annotatedOnly = analysis != null && analysis.issues.length === 0;
  const [analysedText, setAnalysedText] = useState("");
  const [analysisError, setAnalysisError] = useState<string | null>(null);
  const [conversation, setConversation] = useState<ChatMessage[] | null>(null);
  const [fixRound, setFixRound] = useState(0);
  const [toolStatus, setToolStatus] = useState<string | null>(null);

  const [fixedText, setFixedText] = useState("");
  const [thinkingText, setThinkingText] = useState("");
  const [fixAborted, setFixAborted] = useState(false);
  const [fixWarning, setFixWarning] = useState<string | null>(null);
  const [fixError, setFixError] = useState<string | null>(null);
  const [fixSeconds, setFixSeconds] = useState(0);
  const [firstTokenSeconds, setFirstTokenSeconds] = useState<number | null>(null);
  const [tokenCount, setTokenCount] = useState(0);
  const [showPrompt, setShowPrompt] = useState(false);

  // Automatische Nachanalyse des korrigierten Textes (Vorher/Nachher-Vergleich)
  const [recheck, setRecheck] = useState<{
    running: boolean;
    result: AnalyseResult | null;
    error: string | null;
  } | null>(null);
  const recheckIdRef = useRef(0);
  const prevRecheckRunning = useRef(false);

  // Tab-Titel-Blinker für „Aufmerksamkeit“ (endet nach kurzer Zeit)
  const [flash, setFlash] = useState<{ text: string; key: number } | null>(null);

  const abortRef = useRef<AbortController | null>(null);
  const livePaneRef = useRef<HTMLDivElement | null>(null);
  const thinkingPaneRef = useRef<HTMLDivElement | null>(null);
  const fixStartRef = useRef(0);
  const tokensRef = useRef(0);
  const tokenSamplesRef = useRef<{ t: number; n: number }[]>([]);

  // Zeitmesser während der Korrektur
  useEffect(() => {
    if (stage !== "fixing") return;
    fixStartRef.current = Date.now();
    setFixSeconds(0);
    const id = setInterval(() => setFixSeconds(Math.floor((Date.now() - fixStartRef.current) / 1000)), 1000);
    return () => clearInterval(id);
  }, [stage]);

  // Live-Panes automatisch ans Ende scrollen
  useEffect(() => {
    if (stage !== "fixing") return;
    if (livePaneRef.current) livePaneRef.current.scrollTop = livePaneRef.current.scrollHeight;
    if (thinkingPaneRef.current) thinkingPaneRef.current.scrollTop = thinkingPaneRef.current.scrollHeight;
  }, [fixedText, thinkingText, stage]);

  // Tab-Titel: zeigt an, was gerade läuft (sichtbar, wenn nur der Reiter offen ist)
  useEffect(() => {
    if (stage === "analysing") {
      document.title = "⏳ Analyse läuft …";
      return;
    }
    if (stage === "fixing") {
      document.title = fixedText
        ? "✍️ KI schreibt Antwort …"
        : thinkingText
          ? "💭 KI denkt …"
          : "⏳ Warte auf KI …";
      return;
    }
    document.title = BASE_TITLE;
  }, [stage, thinkingText, fixedText]);

  // Aufmerksamkeits-Blink im Tab-Titel (endet von selbst, Icon stoppt)
  useEffect(() => {
    if (!flash) return;
    let i = 0;
    const id = setInterval(() => {
      i += 1;
      document.title = i % 2 === 1 ? flash.text : BASE_TITLE;
      if (i >= 10) {
        clearInterval(id);
        document.title = BASE_TITLE;
      }
    }, 900);
    return () => {
      clearInterval(id);
      document.title = BASE_TITLE;
    };
  }, [flash]);

  // Wenn die Nachanalyse fertig ist: kurzes Blinken mit Ergebnis
  useEffect(() => {
    const wasRunning = prevRecheckRunning.current;
    prevRecheckRunning.current = recheck?.running ?? false;
    if (!wasRunning || !recheck || recheck.running || !recheck.result || !analysis) return;
    const delta = countDelta(analysis, recheck.result);
    if (delta != null && delta < 0) {
      setFlash({ text: "🎉 Besser! – Leichte Sprache", key: Date.now() });
    } else {
      setFlash({ text: "📊 Vergleich fertig – Leichte Sprache", key: Date.now() });
    }
  }, [recheck, analysis]);

  const fixPhase =
    stage !== "fixing"
      ? null
      : toolStatus ??
        (fixedText
          ? "Modell schreibt die Antwort …"
          : thinkingText
            ? "Modell denkt gerade …"
            : fixSeconds < 3
              ? "Anfrage wird gesendet …"
              : "Verbunden – warte auf das erste Token des Modells …");
  // Tokens pro Sekunde über ein Fenster von ~5 s (gleitet mit fixSeconds)
  const tokensPerSecond = (() => {
    if (stage !== "fixing") return null;
    const samples = tokenSamplesRef.current;
    if (samples.length < 2) return null;
    const last = samples[samples.length - 1];
    const windowMs = 5000;
    let i = samples.length - 1;
    while (i > 0 && last.t - samples[i - 1].t < windowMs) i--;
    const first = samples[i];
    const dt = (last.t - first.t) / 1000;
    if (dt < 0.5) return null;
    return (last.n - first.n) / dt;
  })();

  const rateText =
    tokensPerSecond != null ? ` · ${tokensPerSecond.toFixed(1).replace(".", ",")} Tok/s` : "";

  const phaseText = fixPhase
    ? `${settings.selfCheck && fixRound > 0 ? `Runde ${fixRound}/${MAX_ROUNDS} · ` : ""}${fixPhase} Laufzeit: ${formatSeconds(fixSeconds)}` +
      (tokenCount > 0 ? ` · ${tokenCount} Tokens` : "") +
      rateText
    : null;

  useEffect(() => () => abortRef.current?.abort(), []);

  const busy = stage === "analysing" || stage === "fixing";

  const handleAnalyse = async (target: string) => {
    const trimmed = target.trim();
    if (!trimmed) {
      setAnalysisError("Bitte zuerst einen Text eingeben.");
      return;
    }
    if (!settings.analyseUrl.trim()) {
      setAnalysisError("Bitte in den Einstellungen die URL der Leichte-Sprache-Analyse angeben.");
      return;
    }
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    recheckIdRef.current += 1;
    setRecheck(null);
    setStage("analysing");
    setAnalysisError(null);
    setFixAborted(false);
    setFixWarning(null);
    setFixError(null);
    setFixedText("");
    setConversation(null);
    setFixRound(0);
    setToolStatus(null);
    try {
      const result = await analyseText(settings.analyseUrl.trim(), trimmed, controller.signal);
      setAnalysis(result);
      setAnalysedText(trimmed);
      setStage("results");
    } catch (err) {
      if ((err as Error).name === "AbortError") {
        // Abbruch: frühere Analyseergebnisse, falls vorhanden, wieder zeigen
        setStage(analysis ? "results" : "idle");
        return;
      }
      setAnalysisError((err as Error).message);
      setStage("idle");
    }
  };

  const handleFix = async () => {
    if (!analysis) return;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    recheckIdRef.current += 1;
    setRecheck(null);
    setStage("fixing");
    setFixedText("");
    setThinkingText("");
    setFixAborted(false);
    setFixWarning(null);
    setFixError(null);
    setFirstTokenSeconds(null);
    tokensRef.current = 0;
    tokenSamplesRef.current = [];
    setTokenCount(0);
    setShowPrompt(false);
    setFixRound(0);
    setToolStatus(null);
    try {
      const messages = buildFixMessages(
        analysedText,
        analysis.issues,
        analysis.issues.length > 0 ? undefined : analysis.annotatedText,
        settings.selfCheck,
      );
      setConversation(messages);
      const tokenCallbacks = {
        onToken: (chunk: string) => {
          tokensRef.current += 1;
          tokenSamplesRef.current.push({ t: Date.now(), n: tokensRef.current });
          setTokenCount(tokensRef.current);
          setFirstTokenSeconds((s) => s ?? Math.floor((Date.now() - fixStartRef.current) / 1000));
          setFixedText((prev) => prev + chunk);
        },
        onThinking: (chunk: string) => {
          tokensRef.current += 1;
          tokenSamplesRef.current.push({ t: Date.now(), n: tokensRef.current });
          setTokenCount(tokensRef.current);
          setThinkingText((prev) => prev + chunk);
        },
      };
      let raw: string;
      if (settings.selfCheck) {
        const session = await runFixSession({
          settings,
          initialMessages: messages,
          signal: controller.signal,
          maxRounds: MAX_ROUNDS,
          executeTool: executeAnalyseTool,
          callbacks: {
            ...tokenCallbacks,
            onRound: (round) => {
              setFixRound(round);
              setToolStatus(null);
            },
            onToolCall: (name) => setToolStatus(`Modell ruft ${name} auf (prüft seinen eigenen Text) …`),
            onToolResult: () => setToolStatus("Prüfung fertig – Modell überarbeitet den Text …"),
          },
        });
        setConversation(session.messages);
        raw = session.text;
        if (session.warning) setFixWarning(session.warning);
      } else {
        const result = await streamChat({ settings, messages, signal: controller.signal, callbacks: tokenCallbacks });
        raw = result.content;
      }
      const cleaned = cleanModelOutput(raw);
      if (!cleaned.trim()) {
        console.error("LSWUI: Modell-Antwort war nach dem Aufräumen leer. Rohe Antwort:", JSON.stringify(raw));
        throw new Error(
          "Das Modell hat keine verwertbare Antwort geliefert (leer oder nur Formatierung wie Anführungszeichen). Details in der Browser-Konsole (F12).",
        );
      }
      setFixedText(cleaned);
      setStage("fixed");
      setFlash({ text: "✅ Fertig! – Leichte Sprache", key: Date.now() });
      void runRecheck(cleaned);
    } catch (err) {
      if ((err as Error).name === "AbortError") {
        // Abbruch: bisherigen (teilweisen) Text sichtbar lassen
        setFixAborted(true);
        setStage("results");
        return;
      }
      console.error("LSWUI: Korrektur fehlgeschlagen:", err);
      setFixError((err as Error).message || String(err));
      setStage("results");
    }
  };

  const handleUseFixed = () => {
    setText(fixedText);
    void handleAnalyse(fixedText);
  };

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(fixedText);
    } catch {
      /* ignore */
    }
  };

  // Tool-Executor für die Selbstprüfung: führt analyse_text im Browser aus
  const executeAnalyseTool = async (name: string, args: Record<string, unknown>): Promise<string> => {
    if (name !== "analyse_text") return `Unbekanntes Tool: ${name}. Verfügbare Tools: analyse_text.`;
    const text = String(args.text ?? "").trim();
    if (!text) return "Kein Text übergeben. Bitte rufe das Tool mit dem vollständigen umgeschriebenen Text auf.";
    const result = await analyseText(settings.analyseUrl.trim(), text);
    if (result.statistics) {
      const lines = result.issues.slice(0, 15).map((issue, i) => {
        return `${i + 1}. ${issue.rule_id.replace(/_issue$/, "")}: „${issue.text}“ – ${issue.message.slice(0, 200)}`;
      });
      const more = result.issues.length > 15 ? `… und ${result.issues.length - 15} weitere Verstöße.` : "";
      const verdict =
        result.statistics.total_violations === 0
          ? "Der Text entspricht den Regeln für Leichte Sprache."
          : "Behebe die genannten Verstöße und prüfe erneut (falls Prüfrunden übrig sind).";
      return [
        `Verstöße gesamt: ${result.statistics.total_violations} (eindeutig: ${result.statistics.unique_violations}).`,
        "Gefundene Verstöße:",
        ...lines,
        more,
        verdict,
      ]
        .filter(Boolean)
        .join("\n");
    }
    return `Annotierter Text (Markierungen in eckigen Klammern = Probleme):\n${result.annotatedText}`;
  };

  // Nachanalyse des korrigierten Textes für den Vorher/Nachher-Vergleich
  const runRecheck = async (target: string) => {
    const id = ++recheckIdRef.current;
    setRecheck({ running: true, result: null, error: null });
    try {
      const result = await analyseText(settings.analyseUrl.trim(), target.trim());
      if (recheckIdRef.current === id) setRecheck({ running: false, result, error: null });
    } catch (err) {
      if ((err as Error).name !== "AbortError" && recheckIdRef.current === id) {
        setRecheck({ running: false, result: null, error: (err as Error).message });
      }
    }
  };

  const settingsValid = settings.analyseUrl.trim() !== "" && settings.baseUrl.trim() !== "" && settings.model.trim() !== "";

  return (
    <div className="mx-auto max-w-4xl space-y-6 px-4 py-8">
      <header>
        <h1 className="text-2xl font-bold">Leichte Sprache – Text prüfen und verbessern</h1>
        <p className="mt-1 text-slate-400">
          Füge einen deutschen Text ein und prüfe ihn. Die App zeigt alle Probleme, die KI schreibt den Text in Leichter
          Sprache neu – und du siehst jede einzelne Änderung.
        </p>
      </header>

      <SettingsPanel settings={settings} onChange={setSettings} disabled={busy} />

      <section className="rounded-xl border border-slate-800 bg-slate-900 p-4">
        <label htmlFor="input" className="mb-2 block font-semibold">
          Dein Text
        </label>
        <textarea
          id="input"
          value={text}
          onChange={(e) => setText(e.target.value)}
          disabled={busy}
          rows={8}
          placeholder="Hier den deutschen Text einfügen …"
          className="w-full rounded-lg border border-slate-700 bg-slate-950 p-3 text-lg leading-relaxed text-slate-100 focus:border-blue-500 focus:outline-none"
        />
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={() => void handleAnalyse(text)}
            disabled={busy || text.trim() === ""}
            className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 font-semibold text-white hover:bg-blue-500 disabled:cursor-not-allowed disabled:bg-slate-700"
          >
            {stage === "analysing" ? (
              <>
                <Spinner /> Text wird analysiert …
              </>
            ) : (
              "Analysieren"
            )}
          </button>
          {busy && (
            <button
              type="button"
              onClick={() => abortRef.current?.abort()}
              className="rounded-lg border border-slate-700 px-4 py-2 text-slate-300 hover:bg-slate-800"
            >
              Abbrechen
            </button>
          )}
          {stage === "analysing" && <p className="text-sm text-slate-500">Die Analyse prüft den Text auf Regeln der Leichten Sprache. Das dauert nur kurz.</p>}
        </div>
        {analysisError && <p className="mt-3 rounded-lg bg-red-950/60 p-3 text-sm text-red-300">{analysisError}</p>}
      </section>

      {analysis && stage !== "analysing" && (
        <>
          {analysis.issues.length > 0 && analysis.statistics ? (
            <section className="rounded-xl border border-slate-800 bg-slate-900 p-4">
              <h2 className="mb-3 text-lg font-semibold">Gefundene Probleme</h2>
              <IssueList issues={analysis.issues} statistics={analysis.statistics} />
            </section>
          ) : (
            <section className="rounded-xl border border-slate-800 bg-slate-900 p-4">
              <h2 className="mb-2 text-lg font-semibold">Gefundene Probleme</h2>
              <p className="text-sm text-slate-400">
                Diese Analyse liefert nur den annotierten Text (format=annotated_text) – daher gibt es keine
                detaillierte Problem-Liste. Die markierten Stellen sind unten im Text.
              </p>
            </section>
          )}

          <section className="rounded-xl border border-slate-800 bg-slate-900 p-4">
            <h2 className="mb-2 text-lg font-semibold">Text mit Markierungen</h2>
            <p className="mb-3 text-sm text-slate-400">
              {annotatedOnly
                ? "Markierte Stellen (✗) haben Probleme. Zeiger darauf bewegen für Details."
                : "Gelb markierte Stellen haben Probleme. Zeiger darauf bewegen für Details."}
            </p>
            {annotatedOnly ? (
              <AnnotatedMarkers text={analysis.annotatedText} />
            ) : (
              <AnnotatedText text={analysedText} issues={analysis.issues} />
            )}
          </section>

          {analysis.issues.length > 0 ? (
            <section className="rounded-xl border border-slate-800 bg-slate-900 p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h2 className="text-lg font-semibold">Korrektur durch die KI</h2>
                <button
                  type="button"
                  onClick={() => void handleFix()}
                  disabled={busy || !settingsValid}
                  className="inline-flex items-center gap-2 rounded-lg bg-green-600 px-4 py-2 font-semibold text-white hover:bg-green-500 disabled:cursor-not-allowed disabled:bg-slate-700"
                >
                  {stage === "fixing" ? (
                    <>
                      <Spinner /> KI korrigiert …
                    </>
                  ) : (
                    "Mit KI korrigieren"
                  )}
                </button>
              </div>

              {!settingsValid && (
                <p className="mt-2 text-sm text-amber-400">
                  Bitte in den Einstellungen Analyse-URL, Modell-Basis-URL und Modell ergänzen.
                </p>
              )}

              {conversation && (
                <details
                  className="mt-4 rounded-lg border border-slate-800 bg-slate-950"
                  open={showPrompt}
                  onToggle={(e) => setShowPrompt((e.target as HTMLDetailsElement).open)}
                >
                  <summary className="cursor-pointer select-none p-3 text-sm font-semibold text-slate-300">
                    Prompt und Konversation mit der KI anzeigen
                  </summary>
                  <div className="space-y-4 px-3 pb-3">
                    <p className="text-xs text-slate-500">
                      Anfrage-Parameter: <code className="text-slate-400">model={settings.model}</code>
                      {settings.reasoningEffort && (" " + <code className="text-slate-400">reasoning_effort={settings.reasoningEffort}</code>)}
                      {settings.selfCheck && (
                        <>
                          {" "}
                          <code className="text-slate-400">Selbstprüfung: an (Tool: analyse_text, max. {MAX_ROUNDS} Runden)</code>
                        </>
                      )}
                    </p>
                    {conversation.map((msg, i) => {
                      const label =
                        msg.role === "system"
                          ? "System-Prompt"
                          : msg.role === "user"
                            ? "Nutzer-Prompt"
                            : msg.role === "assistant"
                              ? "Antwort des Modells"
                              : "Tool-Ergebnis (analyse_text)";
                      return (
                        <div key={i}>
                          <p
                            className={`mb-1 text-xs font-semibold uppercase tracking-wide ${msg.role === "tool" ? "text-amber-400" : "text-slate-500"}`}
                          >
                            {label}
                          </p>
                          {msg.content && (
                            <pre className="whitespace-pre-wrap rounded-lg border border-slate-700 bg-slate-900 p-3 text-sm text-slate-200">
                              {msg.content}
                            </pre>
                          )}
                          {msg.tool_calls?.map((tc, j) => (
                            <div key={j} className="mt-2 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
                              <p className="text-amber-200">
                                → Modell ruft Tool auf: <code className="text-amber-100">{tc.function.name}</code>
                              </p>
                              <pre className="mt-1 whitespace-pre-wrap text-xs text-amber-200/80">
                                {(() => {
                                  try {
                                    return JSON.stringify(JSON.parse(tc.function.arguments), null, 2);
                                  } catch {
                                    return tc.function.arguments;
                                  }
                                })()}
                              </pre>
                            </div>
                          ))}
                          {msg.role === "assistant" && !msg.content && !msg.tool_calls?.length && stage === "fixing" && (
                            <p className="text-sm text-slate-500">(läuft noch – siehe Live-Fenster unten)</p>
                          )}
                        </div>
                      );
                    })}
                    {thinkingText && (
                      <div>
                        <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-amber-400">
                          Denken des Modells (Thinking)
                        </p>
                        <pre className="max-h-64 overflow-y-auto whitespace-pre-wrap rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-200">
                          {thinkingText}
                        </pre>
                      </div>
                    )}
                    <div>
                      <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">
                        Antwort des Modells {stage === "fixing" && "(läuft noch)"}
                      </p>
                      <pre className="whitespace-pre-wrap rounded-lg border border-slate-700 bg-slate-900 p-3 text-sm text-slate-200">
                        {stage === "fixing"
                          ? fixedText || "(Noch keine Antwort – siehe Live-Fenster unten)"
                          : fixedText || "(keine Antwort erhalten)"}
                      </pre>
                    </div>
                  </div>
                </details>
              )}

              {stage === "fixing" && phaseText && (
                <div className="mt-4 space-y-3">
                  <p className="flex items-center gap-2 text-sm font-medium text-slate-200">
                    <Spinner /> {phaseText}
                  </p>

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
                    <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">
                      Antwort des Modells
                    </p>
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
              )}

              {stage === "results" && fixAborted && (
                <div className="mt-4 space-y-3">
                  <p className="rounded-lg bg-amber-500/10 p-3 text-sm text-amber-200">
                    Korrektur nach {formatSeconds(fixSeconds)} abgebrochen
                    {tokenCount > 0 && ` (${tokenCount} Tokens erhalten)`}. Der bis dahin empfangene Text ist unten.
                  </p>
                  {fixedText ? (
                    <div>
                      <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">
                        Teilweise Antwort des Modells
                      </p>
                      <div className="rounded-lg border border-slate-700 bg-slate-950 p-3 font-mono text-sm text-slate-200 whitespace-pre-wrap">
                        {fixedText}
                      </div>
                      <button
                        type="button"
                        onClick={() => void handleCopy()}
                        className="mt-2 rounded-lg border border-slate-700 px-4 py-2 text-slate-300 hover:bg-slate-800"
                      >
                        Teiltext kopieren
                      </button>
                    </div>
                  ) : (
                    <p className="text-sm text-slate-500">
                      Es ist noch keine Antwort angekommen – nur Denk-Tokens. Bitte erneut versuchen.
                    </p>
                  )}
                  <button
                    type="button"
                    onClick={() => void handleFix()}
                    className="rounded-lg bg-green-600 px-4 py-2 font-semibold text-white hover:bg-green-500"
                  >
                    Erneut korrigieren
                  </button>
                </div>
              )}

              {fixWarning && <p className="mt-3 rounded-lg bg-amber-500/10 p-3 text-sm text-amber-200">{fixWarning}</p>}

              {fixError && (
                <p className="mt-3 rounded-lg bg-red-950/60 p-3 text-sm text-red-300">
                  {fixError}
                  <span className="block text-xs text-red-300/70">Technische Details: Browser-Konsole (F12)</span>
                </p>
              )}

              {stage === "fixed" && (
                <div className="mt-4 space-y-4">
                  <p className="text-sm text-slate-400">
                    Fertig nach {formatSeconds(fixSeconds)}
                    {firstTokenSeconds != null && <> (die Antwort kam erst nach {formatSeconds(firstTokenSeconds)})</>}.
                    Rote, durchgestrichene Wörter wurden entfernt, grüne Wörter neu hinzugefügt.
                  </p>
                  <div className="rounded-lg border border-slate-800 bg-slate-950 p-4">
                    <DiffView original={analysedText} corrected={fixedText} />
                  </div>

                  {recheck && (
                    <div className="rounded-lg border border-slate-800 bg-slate-950 p-4">
                      <h3 className="mb-2 font-semibold">Vorher / Nachher</h3>
                      {recheck.running ? (
                        <p className="flex items-center gap-2 text-sm text-slate-400">
                          <Spinner /> Neue Analyse des korrigierten Textes läuft …
                        </p>
                      ) : recheck.error ? (
                        <p className="text-sm text-red-300">Neue Analyse fehlgeschlagen: {recheck.error}</p>
                      ) : recheck.result ? (
                        <RecheckReport before={analysis} after={recheck.result} />
                      ) : null}
                    </div>
                  )}

                  <div className="flex flex-wrap gap-3">
                    <button
                      type="button"
                      onClick={handleUseFixed}
                      className="rounded-lg bg-blue-600 px-4 py-2 font-semibold text-white hover:bg-blue-700"
                    >
                      Korrektur neu analysieren
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleCopy()}
                      className="rounded-lg border border-slate-700 px-4 py-2 text-slate-300 hover:bg-slate-800"
                    >
                      Korrigierten Text kopieren
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleFix()}
                      className="rounded-lg border border-slate-700 px-4 py-2 text-slate-300 hover:bg-slate-800"
                    >
                      Erneut korrigieren
                    </button>
                  </div>
                </div>
              )}
            </section>
          ) : null}
        </>
      )}
    </div>
  );
}
