import { useState } from "react";
import { DEFAULT_ANALYSE_URL } from "../lib/analyse";
import { testToolCalling } from "../lib/llm";
import type { AppSettings } from "../lib/types";

const STORAGE_KEY = "lswui.llmsettings";

function loadStored(): AppSettings | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as AppSettings) : null;
  } catch {
    return null;
  }
}

interface Props {
  settings: AppSettings;
  onChange: (s: AppSettings) => void;
  disabled: boolean;
}

export function SettingsPanel({ settings, onChange, disabled }: Props) {
  const [remember, setRemember] = useState(() => loadStored() !== null);
  const [models, setModels] = useState<string[]>([]);
  const [modelHint, setModelHint] = useState<string | null>(null);
  const [toolTest, setToolTest] = useState<{ running: boolean; ok: boolean | null; message: string | null }>({
    running: false,
    ok: null,
    message: null,
  });

  const runToolTest = async () => {
    setToolTest({ running: true, ok: null, message: null });
    try {
      const result = await testToolCalling(settings);
      setToolTest({ running: false, ok: result.ok, message: result.message });
    } catch (err) {
      console.error("LSWUI: Tool-Calling-Test fehlgeschlagen:", err);
      setToolTest({ running: false, ok: false, message: `Test fehlgeschlagen: ${(err as Error).message}` });
    }
  };

  const set = (patch: Partial<AppSettings>) => onChange({ ...settings, ...patch });

  const rememberToggle = (checked: boolean) => {
    setRemember(checked);
    if (checked) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
    } else {
      localStorage.removeItem(STORAGE_KEY);
    }
  };

  const loadModels = async () => {
    setModelHint(null);
    try {
      const base = settings.baseUrl.trim().replace(/\/+$/, "");
      const res = await fetch(`${base}/models`, {
        headers: settings.apiKey ? { Authorization: `Bearer ${settings.apiKey}` } : {},
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = (await res.json()) as { data?: { id: string }[] };
      const ids = (body.data ?? []).map((m) => m.id);
      if (ids.length === 0) throw new Error("keine Modelle gelistet");
      setModels(ids);
    } catch (err) {
      setModels([]);
      setModelHint(`Modelle konnten nicht geladen werden (${(err as Error).message}). Manuell eingeben.`);
    }
  };

  return (
    <details
      className="rounded-xl border border-slate-800 bg-slate-900 p-4"
      open={disabled ? undefined : remember ? undefined : true}
    >
      <summary className="cursor-pointer select-none text-sm font-semibold text-slate-300">
        Einstellungen (Analyse-API und KI-Modell)
      </summary>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <label className="block sm:col-span-2">
          <span className="mb-1 block text-sm text-slate-400">URL der Leichte-Sprache-Analyse</span>
          <input
            type="url"
            value={settings.analyseUrl}
            onChange={(e) => set({ analyseUrl: e.target.value })}
            disabled={disabled}
            placeholder={DEFAULT_ANALYSE_URL}
            className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 focus:border-blue-500 focus:outline-none"
          />
          <span className="mt-1 block text-xs text-slate-500">
            Vollständige URL des Analyse-Endpoints (POST, JSON <code>{'{ "text": "…" }'}</code>)
          </span>
        </label>
        <label className="block sm:col-span-2">
          <span className="mb-1 block text-sm text-slate-400">Modell: Basis-URL (OpenAI-kompatibel)</span>
          <input
            type="url"
            value={settings.baseUrl}
            onChange={(e) => set({ baseUrl: e.target.value })}
            disabled={disabled}
            placeholder="https://beispiel.de/v1"
            className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 focus:border-blue-500 focus:outline-none"
          />
        </label>
        <label className="relative block">
          <span className="mb-1 block text-sm text-slate-400">Modell</span>
          <input
            list="lswui-models"
            value={settings.model}
            onChange={(e) => set({ model: e.target.value })}
            disabled={disabled}
            placeholder="Modellname"
            className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 focus:border-blue-500 focus:outline-none"
          />
          <datalist id="lswui-models">
            {models.map((m) => (
              <option key={m} value={m} />
            ))}
          </datalist>
          <button
            type="button"
            onClick={loadModels}
            disabled={disabled || !settings.baseUrl}
            className="mt-1 text-xs text-blue-400 hover:underline disabled:text-slate-600"
          >
            Modelle laden
          </button>
        </label>
        <label className="block">
          <span className="mb-1 block text-sm text-slate-400">Denk-Aufwand (Reasoning Effort)</span>
          <select
            value={settings.reasoningEffort}
            onChange={(e) => set({ reasoningEffort: e.target.value as AppSettings["reasoningEffort"] })}
            disabled={disabled}
            className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 focus:border-blue-500 focus:outline-none"
          >
            <option value="">Automatisch (Modell-Standard)</option>
            <option value="minimal">minimal – denk so wenig wie möglich</option>
            <option value="low">low – wenig denken</option>
            <option value="medium">medium – ausgewogen</option>
            <option value="high">high – gründlich denken</option>
            <option value="xhigh">xhigh – sehr gründlich</option>
          </select>
          <span className="mt-1 block text-xs text-slate-500">
            Gilt nur für Reasoning-Modelle. Nicht unterstützte Parameter werden vom Server meist ignoriert.
          </span>
        </label>
        <label className="block">
          <span className="mb-1 block text-sm text-slate-400">API-Schlüssel</span>
          <input
            type="password"
            value={settings.apiKey}
            onChange={(e) => set({ apiKey: e.target.value })}
            disabled={disabled}
            placeholder="wird nur im Browser gespeichert/gesendet"
            className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 focus:border-blue-500 focus:outline-none"
          />
        </label>
        <div className="sm:col-span-2">
          <label className="flex items-start gap-2">
            <input
              type="checkbox"
              checked={settings.selfCheck}
              onChange={(e) => set({ selfCheck: e.target.checked })}
              disabled={disabled}
              className="mt-0.5 h-4 w-4 rounded border-slate-600"
            />
            <span className="text-sm text-slate-400">
              Selbstprüfung (Tool Calling): Das Modell darf die Analyse selbst auf seinen eigenen Text anwenden und ihn
              überarbeiten.
              <span className="block text-xs text-slate-500">
                Nur aktivieren, wenn das Modell Tool-Calling unterstützt. Dauert länger (mehr Runden).
              </span>
            </span>
          </label>
          <div className="mt-1 pl-6">
            <button
              type="button"
              onClick={() => void runToolTest()}
              disabled={disabled || toolTest.running || !settings.baseUrl.trim() || !settings.model.trim()}
              className="text-xs text-blue-400 hover:underline disabled:text-slate-600"
            >
              {toolTest.running ? "Teste Tool-Calling …" : "Tool-Calling mit diesem Modell testen"}
            </button>
            {toolTest.message && (
              <p className={`mt-1 text-xs ${toolTest.ok ? "text-green-400" : "text-red-300"}`}>{toolTest.message}</p>
            )}
          </div>
        </div>
        <label className="flex items-center gap-2 sm:col-span-2">
          <input
            type="checkbox"
            checked={remember}
            onChange={(e) => rememberToggle(e.target.checked)}
            disabled={disabled}
            className="h-4 w-4 rounded border-slate-600"
          />
          <span className="text-sm text-slate-400">
            Einstellungen in diesem Browser merken
          </span>
        </label>
        {modelHint && <p className="text-sm text-amber-400 sm:col-span-2">{modelHint}</p>}
        <p className="text-xs text-slate-500 sm:col-span-2">
          Der API-Schlüssel verlässt den Browser nur direkt zum angegebenen Modell-Endpunkt.
        </p>
      </div>
    </details>
  );
}
