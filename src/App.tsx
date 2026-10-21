import { useEffect, useRef, useState } from "react";
import { DEFAULT_ANALYSE_URL, analyseText, violationCount } from "./lib/analyse";
import { buildFixMessages, cleanModelOutput, streamChat, type ChatMessage } from "./lib/llm";
import type { AnalyseResult, AppSettings, FixRound } from "./lib/types";
import { buildReportMarkdown, downloadMarkdown, reportFilename } from "./lib/report";
import { AnnotatedText } from "./components/AnnotatedText";
import { AnnotatedMarkers } from "./components/AnnotatedMarkers";
import { IssueList } from "./components/IssueList";
import { FixedReport } from "./components/FixedReport";
import { roundEntries, RoundsReport } from "./components/RoundsReport";
import { SettingsPanel } from "./components/SettingsPanel";

const STORAGE_KEY = "lswui.llmsettings";
const BASE_TITLE = "Leichte Sprache – Text prüfen und verbessern";

type Stage = "idle" | "analysing" | "results" | "fixing" | "fixed";

const REASONING_EFFORTS: readonly string[] = ["", "minimal", "low", "medium", "high", "xhigh"];

/** Zahl auf ganzzahligen Wert im Bereich begrenzen (Standard bei ungültigem Input). */
function clampInt(v: number | undefined, min: number, max: number, dflt: number): number {
  const n = typeof v === "number" && Number.isFinite(v) ? Math.floor(v) : dflt;
  return Math.max(min, Math.min(max, n));
}

/**
 * Validiert die in localStorage gespeicherten Einstellungen (unbekannter
 * Ursprung) und gibt nur Felder zurück, die den erwarteten Typen entsprechen.
 */
function sanitizeStored(raw: unknown): Partial<AppSettings> {
  if (!raw || typeof raw !== "object") return {};
  const o = raw as Record<string, unknown>;
  const str = (k: string): string | undefined => (typeof o[k] === "string" ? (o[k] as string) : undefined);
  const out: Partial<AppSettings> = {};
  const a = str("analyseUrl");
  if (a !== undefined) out.analyseUrl = a;
  const b = str("baseUrl");
  if (b !== undefined) out.baseUrl = b;
  const m = str("model");
  if (m !== undefined) out.model = m;
  const k = str("apiKey");
  if (k !== undefined) out.apiKey = k;
  const r = str("reasoningEffort");
  if (r !== undefined) out.reasoningEffort = REASONING_EFFORTS.includes(r) ? (r as AppSettings["reasoningEffort"]) : "";
  if (typeof o.fixRounds === "number") out.fixRounds = clampInt(o.fixRounds, 1, 10, 3);
  if (typeof o.tolerance === "number") out.tolerance = clampInt(o.tolerance, 0, 999, 0);
  return out;
}

function defaultSettings(): AppSettings {
  let stored: Partial<AppSettings> = {};
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    stored = raw ? sanitizeStored(JSON.parse(raw)) : {};
  } catch {
    /* ignore */
  }
  // Bewusst „??“, nicht „||“: ein bewusst geleertes Feld (z. B. "") bleibt leer,
  // statt still zurück auf den Build-Zeit-Wert zu fallen.
  return {
    analyseUrl: stored.analyseUrl ?? import.meta.env.LSWUI_ANALYSE_URL ?? DEFAULT_ANALYSE_URL,
    baseUrl: stored.baseUrl ?? import.meta.env.LSWUI_BASE_URL ?? "",
    model: stored.model ?? import.meta.env.LSWUI_MODEL ?? "",
    apiKey: stored.apiKey ?? import.meta.env.LSWUI_API_KEY ?? "",
    reasoningEffort: stored.reasoningEffort ?? "",
    fixRounds: stored.fixRounds ?? 3,
    tolerance: stored.tolerance ?? 0,
  };
}

/** Text in die Zwischenablage – mit Fallback für Kontexte ohne Clipboard-Write-Zugriff. */
async function copyToClipboard(value: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(value);
    return true;
  } catch {
    try {
      const ta = document.createElement("textarea");
      ta.value = value;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand("copy");
      ta.remove();
      return ok;
    } catch {
      return false;
    }
  }
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
  const [analysis, setAnalysis] = useState<AnalyseResult | null>(null);
  /**
   * true, wenn die Analyse nur den annotierten Text liefert
   * (format=annotated_text). Erkennbar am FEHLEN der Statistik – nicht an
   * issues.length (ein sauberer format=full-Text hat ebenfalls 0 Issues).
   */
  const annotatedOnly = analysis != null && analysis.statistics == null;
  const [analysedText, setAnalysedText] = useState("");
  const [analysisError, setAnalysisError] = useState<string | null>(null);
  const [conversation, setConversation] = useState<ChatMessage[] | null>(null);

  const [fixedText, setFixedText] = useState("");
  const [thinkingText, setThinkingText] = useState("");
  const [fixAborted, setFixAborted] = useState(false);
  const [fixError, setFixError] = useState<string | null>(null);
  const [fixSeconds, setFixSeconds] = useState(0);
  const [firstTokenSeconds, setFirstTokenSeconds] = useState<number | null>(null);
  const [tokenCount, setTokenCount] = useState(0);
  const [showPrompt, setShowPrompt] = useState(false);

  // Mehr-Runden-Korrektur: alle abgeschlossenen Runden (für Bericht und
  // Versions-Vergleich) plus Status der gerade laufenden Korrektur
  const [fixRoundList, setFixRoundList] = useState<FixRound[]>([]);
  /** Nummer der gerade laufenden Runde (für Statusanzeige) */
  const [fixRound, setFixRound] = useState(0);
  /** true, während das Ergebnis einer Runde analysiert wird */
  const [fixChecking, setFixChecking] = useState(false);
  /**
   * Stop-Grund: "clean" = Toleranz erreicht, "limit" = Rundenlimit,
   * "error" = Abbruch durch Fehler, "failed" = Runde verworfen (Verschlechterung)
   */
  const [fixStopReason, setFixStopReason] = useState<"clean" | "limit" | "error" | "failed" | null>(null);
  const [fixWarning, setFixWarning] = useState<string | null>(null);
  /** Angezeigte Version im Versions-Vergleich: 0 = Original, n = Runde n */
  const [selVersion, setSelVersion] = useState(0);

  // Tab-Titel-Blinker für „Aufmerksamkeit“ (endet nach kurzer Zeit)
  const [flash, setFlash] = useState<{ text: string; key: number } | null>(null);
  const [copyNote, setCopyNote] = useState<string | null>(null);
  const copyNoteTimerRef = useRef<number>(0);

  const abortRef = useRef<AbortController | null>(null);
  const livePaneRef = useRef<HTMLDivElement | null>(null);
  const thinkingPaneRef = useRef<HTMLDivElement | null>(null);
  const fixStartRef = useRef(0);
  const tokensRef = useRef(0);
  const tokenSamplesRef = useRef<{ t: number; n: number }[]>([]);

  // Zeitmesser während der Korrektur (fixStartRef wird in handleFix gesetzt,
  // damit der Startzeitpunkt nicht nach dem ersten Token liegt)
  useEffect(() => {
    if (stage !== "fixing") return;
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
    // Während eines Aufmerksamkeits-Blinks die Titel-Hoheit abgeben
    if (flash) return;
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
  }, [stage, thinkingText, fixedText, flash]);

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

  const fixMaxRounds = clampInt(settings.fixRounds, 1, 10, 3);
  const tolerance = clampInt(settings.tolerance, 0, 999, 0);
  const fixPhase =
    stage !== "fixing"
      ? null
      : `Runde ${Math.max(1, fixRound)}/${fixMaxRounds} · ` +
        (fixChecking
          ? "Ergebnis wird geprüft (Analyse) …"
          : fixedText
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
    setFixWarning(null);
    setFixError(null);
    setFixedText("");
    setConversation(null);
    setFixRoundList([]);
    setFixStopReason(null);
    setSelVersion(0);
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

  /**
   * Mehr-Runden-Korrektur: Die KI schreibt den Text um, die App analysiert das
   * Ergebnis. Solange mehr Verstöße als die Toleranz übrig sind und Runden
   * bleiben, geht der Text mit den neuen Problemen zur nächsten Runde zurück.
   */
  const handleFix = async () => {
    if (!analysis) return;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    fixStartRef.current = Date.now();
    const maxRounds = clampInt(settings.fixRounds, 1, 10, 3);
    const tol = clampInt(settings.tolerance, 0, 999, 0);
    setStage("fixing");
    setFixRound(0);
    setFixChecking(false);
    setFixRoundList([]);
    setFixStopReason(null);
    setFixWarning(null);
    setFixedText("");
    setThinkingText("");
    setFixAborted(false);
    setFixError(null);
    setFirstTokenSeconds(null);
    tokensRef.current = 0;
    tokenSamplesRef.current = [];
    setTokenCount(0);
    setShowPrompt(false);
    setSelVersion(0);
    // Arbeitszustand des Loops (lokal, damit Abbruch/Fehler keinen veralteten
    // React-State weiterverwenden)
    let history: FixRound[] = [];
    let stopReason: "clean" | "limit" | "error" | "failed" | null = null;
    let currentText = analysedText;
    let currentAnalysis: AnalyseResult = analysis;
    /** Verstöße des aktuell übernommenen Textes (Start: Original) */
    let baselineCount = violationCount(analysis);
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
    try {
      for (let round = 1; round <= maxRounds; round++) {
        setFixRound(round);
        setFixChecking(false);
        setFixedText("");
        setThinkingText("");
        // Zeit- und Token-Zähler für den Bericht dieser Runde
        const roundStart = Date.now();
        const tokensAtRoundStart = tokensRef.current;
        const messages = buildFixMessages(
          currentText,
          currentAnalysis.issues,
          currentAnalysis.statistics != null ? undefined : currentAnalysis.annotatedText,
        );
        setConversation(messages);
        const raw = await streamChat({ settings, messages, signal: controller.signal, callbacks: tokenCallbacks });
        const cleaned = cleanModelOutput(raw);
        if (!cleaned.trim()) {
          console.error("LSWUI: Modell-Antwort war nach dem Aufräumen leer. Rohe Antwort:", JSON.stringify(raw));
          throw new Error(
            "Das Modell hat keine verwertbare Antwort geliefert (leer oder nur Formatierung wie Anführungszeichen). Details in der Browser-Konsole (F12).",
          );
        }
        setFixedText(cleaned);
        // Ergebnis dieser Runde prüfen – so wissen wir, ob es weitergehen muss
        setFixChecking(true);
        let roundAnalysis: AnalyseResult | null = null;
        let analyseFailed = false;
        try {
          roundAnalysis = await analyseText(settings.analyseUrl.trim(), cleaned, controller.signal);
        } catch (err) {
          if ((err as Error).name === "AbortError") throw err;
          console.error("LSWUI: Analyse nach Runde", round, "fehlgeschlagen:", err);
          analyseFailed = true;
          setFixWarning(
            `Die Prüfung nach Runde ${round} ist fehlgeschlagen (${(err as Error).message}). ` +
              "Diese Runde wurde nicht übernommen.",
          );
        }
        setFixChecking(false);
        const count = violationCount(roundAnalysis);
        // Nur übernehmen, wenn die Runde nicht schlechter ist: Das Modell kann
        // verschlechtern – dann bleibt der bessere Stand, die Runde wird als
        // verworfen markiert und die Korrektur endet.
        const accepted = !analyseFailed && (count == null || baselineCount == null || count <= baselineCount);
        history = [
          ...history,
          {
            round,
            text: cleaned,
            analysis: roundAnalysis,
            seconds: Math.round((Date.now() - roundStart) / 1000),
            tokens: tokensRef.current - tokensAtRoundStart,
            accepted,
          },
        ];
        setFixRoundList(history);
        if (!accepted) {
          // Nicht stoppen: Es wird mit dem besseren Stand weiterprobiert, bis
          // die letzte Runde erreicht ist. currentText/currentAnalysis und
          // baselineCount bleiben deshalb unverändert.
          stopReason = analyseFailed ? "error" : "failed";
          continue;
        }
        // Angenommene Runde löst frühere Ablehnungen auf
        stopReason = null;
        if (count != null && count <= tol) {
          stopReason = "clean";
          break;
        }
        currentText = cleaned;
        currentAnalysis = roundAnalysis as AnalyseResult;
        baselineCount = count;
      }
      if (stopReason == null) stopReason = "limit"; // Runden aufgebraucht, Toleranz nicht erreicht
      setFixStopReason(stopReason);
      // Ergebnis = letzte angenommene Runde (oder Original, falls keine).
      // Version-Nummer = POSITION der Runde in der Liste (dazwischen können
      // verworfene Runden liegen).
      const lastAcceptedPos = history.map((r) => r.accepted).lastIndexOf(true); // -1 = keine
      const lastAccepted = lastAcceptedPos >= 0 ? history[lastAcceptedPos] : null;
      setFixedText(lastAccepted ? lastAccepted.text : analysedText);
      setSelVersion(Math.max(0, lastAcceptedPos + 1));
      setStage("fixed");
      setFlash({ text: "✅ Fertig! – Leichte Sprache", key: Date.now() });
    } catch (err) {
      if ((err as Error).name === "AbortError") {
        // Abbruch: bisherigen (teilweisen) Text sichtbar lassen
        setFixAborted(true);
        setStage("results");
        return;
      }
      console.error("LSWUI: Korrektur fehlgeschlagen:", err);
      const msg = (err as Error).message || String(err);
      if (history.length > 0) {
        // Frühere Runde steht: beste Version zeigen, statt alles zu verwerfen
        const lastAcceptedPos = history.map((r) => r.accepted).lastIndexOf(true); // -1 = keine
        const lastAccepted = lastAcceptedPos >= 0 ? history[lastAcceptedPos] : null;
        setFixedText(lastAccepted ? lastAccepted.text : analysedText);
        setSelVersion(Math.max(0, lastAcceptedPos + 1));
        setFixWarning(`Runde ${history.length + 1} ist fehlgeschlagen (${msg}). Es wird der letzte gute Entwurf angezeigt.`);
        setFixStopReason("error");
        setStage("fixed");
      } else {
        setFixError(msg);
        setStage("results");
      }
    }
  };

  const handleUseFixed = () => {
    setText(fixedText);
    void handleAnalyse(fixedText);
  };

  /** Bericht (Markdown) mit allen Runden, Zahlen und Änderungen herunterladen. */
  const handleExport = () => {
    if (!analysis) return;
    const md = buildReportMarkdown({
      analysedText,
      analysis,
      rounds: fixRoundList,
      settings,
      totalSeconds: fixSeconds,
      firstTokenSeconds,
      totalTokens: tokenCount,
      stopReason: fixStopReason,
    });
    downloadMarkdown(reportFilename(), md);
  };

  const handleCopy = async () => {
    const ok = await copyToClipboard(fixedText);
    setCopyNote(ok ? "In die Zwischenablage kopiert." : "Kopieren fehlgeschlagen – bitte Text manuell auswählen und kopieren.");
    window.clearTimeout(copyNoteTimerRef.current);
    copyNoteTimerRef.current = window.setTimeout(() => setCopyNote(null), 3000);
  };

  /** Angezeigte Version, begrenzt auf die vorhandene Anzahl von Runden */
  const shownVersion = Math.min(selVersion, fixRoundList.length);

  const settingsValid = settings.analyseUrl.trim() !== "" && settings.baseUrl.trim() !== "" && settings.model.trim() !== "";

  return (
    <div className="mx-auto max-w-4xl space-y-6 px-4 py-8">
      <header>
        <h1 className="text-2xl font-bold">Leichte Sprache – Text prüfen und verbessern</h1>
        <p className="mt-1 text-slate-400">
          Füge einen deutschen Text ein und prüfe ihn. Die App zeigt alle Probleme, die KI schreibt den Text in Leichter
          Sprache neu – in mehreren Runden, bis keine Probleme mehr übrig sind – und du siehst jede einzelne Änderung.
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
          {analysis.statistics != null ? (
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

          {analysis.issues.length > 0 || annotatedOnly ? (
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
                      {settings.reasoningEffort && (
                        <>
                          {" "}
                          <code className="text-slate-400">reasoning_effort={settings.reasoningEffort}</code>
                        </>
                      )}
                    </p>
                    {conversation.map((msg, i) => {
                      const label =
                        msg.role === "system"
                          ? "System-Prompt"
                          : msg.role === "user"
                            ? "Nutzer-Prompt"
                            : "Antwort des Modells";
                      return (
                        <div key={i}>
                          <p
                            className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500"
                          >
                            {label}
                          </p>
                          {msg.content && (
                            <pre className="whitespace-pre-wrap rounded-lg border border-slate-700 bg-slate-900 p-3 text-sm text-slate-200">
                              {msg.content}
                            </pre>
                          )}
                          {msg.role === "assistant" && !msg.content && stage === "fixing" && (
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

                  {/* Live-Bericht: fertige Runden erscheinen, sobald ihre Prüfung da ist */}
                  {analysis && (
                    <div className="rounded-lg border border-slate-800 bg-slate-950 p-4">
                      <RoundsReport
                        tolerance={tolerance}
                        rounds={[
                          ...roundEntries(analysis, fixRoundList),
                          // Platzhalterzeile für die gerade laufende Runde
                          ...(fixRound > fixRoundList.length
                            ? [
                                {
                                  label: `Runde ${fixRound} …`,
                                  analysis: null,
                                  seconds: null,
                                  tokens: null,
                                  failed: false,
                                },
                              ]
                            : []),
                        ]}
                      />
                    </div>
                  )}

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
                      {copyNote && <p className="mt-2 text-sm text-slate-300">{copyNote}</p>}
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

              {fixError && (
                <p className="mt-3 rounded-lg bg-red-950/60 p-3 text-sm text-red-300">
                  {fixError}
                  <span className="block text-xs text-red-300/70">Technische Details: Browser-Konsole (F12)</span>
                </p>
              )}

              {stage === "fixed" && analysis && (
                <FixedReport
                  analysis={analysis}
                  analysedText={analysedText}
                  fixRoundList={fixRoundList}
                  fixStopReason={fixStopReason}
                  fixMaxRounds={fixMaxRounds}
                  tolerance={tolerance}
                  fixSeconds={fixSeconds}
                  firstTokenSeconds={firstTokenSeconds}
                  tokenCount={tokenCount}
                  fixWarning={fixWarning}
                  shownVersion={shownVersion}
                  onSelVersion={setSelVersion}
                  copyNote={copyNote}
                  onUseFixed={handleUseFixed}
                  onCopy={() => void handleCopy()}
                  onFixAgain={() => void handleFix()}
                  onExport={handleExport}
                />
              )}
            </section>
          ) : null}
        </>
      )}
    </div>
  );
}
