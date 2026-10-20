import { useEffect, useRef, useState } from "react";
import { DEFAULT_ANALYSE_URL, analyseText } from "./lib/analyse";
import { buildFixMessages, streamChat, type ChatMessage } from "./lib/llm";
import type { AnalyseResponse, AppSettings } from "./lib/types";
import { AnnotatedText } from "./components/AnnotatedText";
import { IssueList } from "./components/IssueList";
import { DiffView } from "./components/DiffView";
import { SettingsPanel } from "./components/SettingsPanel";

const STORAGE_KEY = "lswui.llmsettings";

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

export default function App() {
  const [text, setText] = useState("");
  const [settings, setSettings] = useState<AppSettings>(defaultSettings);

  const [stage, setStage] = useState<Stage>("idle");
  const [analysis, setAnalysis] = useState<AnalyseResponse | null>(null);
  const [analysedText, setAnalysedText] = useState("");
  const [analysisError, setAnalysisError] = useState<string | null>(null);
  const [lastPrompt, setLastPrompt] = useState<ChatMessage[] | null>(null);

  const [fixedText, setFixedText] = useState("");
  const [thinkingText, setThinkingText] = useState("");
  const [fixAborted, setFixAborted] = useState(false);
  const [fixError, setFixError] = useState<string | null>(null);
  const [fixSeconds, setFixSeconds] = useState(0);
  const [firstTokenSeconds, setFirstTokenSeconds] = useState<number | null>(null);
  const [tokenCount, setTokenCount] = useState(0);
  const [showPrompt, setShowPrompt] = useState(false);

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

  const fixPhase =
    stage !== "fixing"
      ? null
      : fixedText
        ? "Modell schreibt die Antwort …"
        : thinkingText
          ? "Modell denkt gerade …"
          : fixSeconds < 3
            ? "Anfrage wird gesendet …"
            : "Verbunden – warte auf das erste Token des Modells …";
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
    ? `${fixPhase} Laufzeit: ${formatSeconds(fixSeconds)}` +
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
    setStage("analysing");
    setAnalysisError(null);
    setFixAborted(false);
    setFixError(null);
    setFixedText("");
    setLastPrompt(null);
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
    setStage("fixing");
    setFixedText("");
    setThinkingText("");
    setFixAborted(false);
    setFixError(null);
    setFirstTokenSeconds(null);
    tokensRef.current = 0;
    tokenSamplesRef.current = [];
    setTokenCount(0);
    setShowPrompt(false);
    try {
      const messages = buildFixMessages(analysedText, analysis.issues);
      setLastPrompt(messages);
      await streamChat({
        settings,
        messages,
        signal: controller.signal,
        callbacks: {
          onToken: (chunk) => {
            tokensRef.current += 1;
            tokenSamplesRef.current.push({ t: Date.now(), n: tokensRef.current });
            setTokenCount(tokensRef.current);
            setFirstTokenSeconds((s) => s ?? Math.floor((Date.now() - fixStartRef.current) / 1000));
            setFixedText((prev) => prev + chunk);
          },
          onThinking: (chunk) => {
            tokensRef.current += 1;
            tokenSamplesRef.current.push({ t: Date.now(), n: tokensRef.current });
            setTokenCount(tokensRef.current);
            setThinkingText((prev) => prev + chunk);
          },
        },
      });
      setStage("fixed");
    } catch (err) {
      if ((err as Error).name === "AbortError") {
        // Abbruch: bisherigen (teilweisen) Text sichtbar lassen
        setFixAborted(true);
        setStage("results");
        return;
      }
      setFixError((err as Error).message);
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
          <section className="rounded-xl border border-slate-800 bg-slate-900 p-4">
            <h2 className="mb-3 text-lg font-semibold">Gefundene Probleme</h2>
            <IssueList issues={analysis.issues} statistics={analysis.statistics} />
          </section>

          <section className="rounded-xl border border-slate-800 bg-slate-900 p-4">
            <h2 className="mb-2 text-lg font-semibold">Text mit Markierungen</h2>
            <p className="mb-3 text-sm text-slate-400">
              Gelb markierte Stellen haben Probleme. Zeiger darauf bewegen für Details.
            </p>
            <AnnotatedText text={analysedText} issues={analysis.issues} />
          </section>

          {analysis.issues.length > 0 && (
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

              {lastPrompt && (
                <details
                  className="mt-4 rounded-lg border border-slate-800 bg-slate-950"
                  open={showPrompt}
                  onToggle={(e) => setShowPrompt((e.target as HTMLDetailsElement).open)}
                >
                  <summary className="cursor-pointer select-none p-3 text-sm font-semibold text-slate-300">
                    Prompt und Konversation mit der KI anzeigen
                  </summary>
                  <div className="space-y-4 px-3 pb-3">
                    {lastPrompt.map((msg, i) => (
                      <div key={i}>
                        <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">
                          {msg.role === "system" ? "System-Prompt" : "Nutzer-Prompt"}
                        </p>
                        <pre className="whitespace-pre-wrap rounded-lg border border-slate-700 bg-slate-900 p-3 text-sm text-slate-200">
                          {msg.content}
                        </pre>
                      </div>
                    ))}
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

              {fixError && <p className="mt-3 rounded-lg bg-red-950/60 p-3 text-sm text-red-300">{fixError}</p>}

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
          )}
        </>
      )}
    </div>
  );
}
