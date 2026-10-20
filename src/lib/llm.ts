import type { AppSettings, Issue } from "./types";

const SYSTEM_PROMPT = [
  "Du bist ein Assistent, der deutsche Texte in Leichte Sprache umschreibt.",
  "Du erhältst einen Text und eine Liste gefundener Probleme (mit Regel und Erläuterung).",
  "Schreibe den Text in klarer, korrekter Leichter Sprache um:",
  "- Behebe alle genannten Probleme.",
  "- Verwende kurze Sätze und einfache, gebräuchliche deutsche Wörter.",
  "- Halte Inhalt und Bedeutung des Textes bei.",
  "Antworte NUR mit dem korrigierten Text. Keine Erklärungen, keine Einleitung, keine Rahmen durch Anführungszeichen oder Code-Blöcke.",
].join("\n");

function buildUserPrompt(text: string, issues: Issue[]): string {
  const issueLines = issues.map((issue, i) => {
    return `${i + 1}. Regel: ${issue.rule_id} – Betroffener Text: „${issue.text}“ – ${issue.message}`;
  });
  return [
    "Text:",
    '"""',
    text,
    '"""',
    "",
    "Gefundene Probleme:",
    issueLines.length > 0 ? issueLines.join("\n") : "(keine Probleme gefunden)",
  ].join("\n");
}

export interface ChatMessage {
  role: "system" | "user";
  content: string;
}

export interface StreamCallbacks {
  /** Ein neues Stück des sichtbaren Antworttextes */
  onToken?: (chunk: string) => void;
  /** Ein neues Stück „Denk“-Tokens (Reasoning-Modelle, Feld reasoning_content) */
  onThinking?: (chunk: string) => void;
  /** Der Server hat angefangen zu senden (erste Daten empfangen) */
  onFirstByte?: () => void;
  /** Das erste sichtbare Antwort-Token ist angekommen */
  onFirstToken?: () => void;
}

interface StreamChatOptions {
  settings: AppSettings;
  messages: ChatMessage[];
  callbacks?: StreamCallbacks;
  signal?: AbortSignal;
}

/**
 * Ruft einen OpenAI-kompatiblen /chat/completions-Endpunkt auf und
 * streamt die Antwort tokenweise (SSE). Gibt den vollständigen Text zurück.
 */
export async function streamChat({ settings, messages, callbacks, signal }: StreamChatOptions): Promise<string> {
  const base = settings.baseUrl.trim().replace(/\/+$/, "");
  let res: Response;
  try {
    res = await fetch(`${base}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(settings.apiKey ? { Authorization: `Bearer ${settings.apiKey}` } : {}),
      },
      body: JSON.stringify({
        model: settings.model,
        messages,
        stream: true,
        ...(settings.reasoningEffort ? { reasoning_effort: settings.reasoningEffort } : {}),
      }),
      signal,
    });
  } catch (err) {
    if ((err as Error).name === "AbortError") throw err;
    throw new Error(
      "Das Modell-Endpunkt hat die Anfrage im Browser abgelehnt. " +
        "Ursache ist meist CORS oder die Erreichbarkeit des Servers. " +
        `Geprüfte Adresse: ${base}/chat/completions`,
    );
  }

  if (!res.ok) {
    let detail = "";
    try {
      const body = (await res.json()) as { error?: { message?: string } | string };
      detail = typeof body.error === "string" ? body.error : body.error?.message ?? "";
    } catch {
      /* ignore */
    }
    if (res.status === 401 || res.status === 403) {
      throw new Error(`Zugang verweigert (HTTP ${res.status}). Bitte API-Schlüssel prüfen.${detail ? ` ${detail}` : ""}`);
    }
    if (res.status === 404) {
      throw new Error(`HTTP 404 – Bitte Modell-Name und Basis-URL prüfen. (Basis-URL soll auf …/v1 enden.)`);
    }
    throw new Error(`Modell-Endpunkt-Fehler (HTTP ${res.status})${detail ? `: ${detail}` : ""}`);
  }

  const contentType = res.headers.get("content-type") ?? "";
  const reader = res.body?.getReader();
  if (!reader) throw new Error("Kein Datenstrom vom Modell-Endpunkt erhalten.");

  callbacks?.onFirstByte?.();
  const isSse = contentType.includes("text/event-stream");

  const decoder = new TextDecoder();
  let buffer = "";
  let full = "";
  let fullEmitted = false;
  let receivedAny = false;
  let sawSseData = false;

  const handleSseLine = (line: string) => {
    if (!line.startsWith("data:")) return;
    const payload = line.slice(5).trim();
    if (payload === "[DONE]") return;
    try {
      const json = JSON.parse(payload) as {
        choices?: {
          delta?: { content?: string; reasoning_content?: string; reasoning?: string };
          message?: { content?: string; reasoning_content?: string; reasoning?: string };
        }[];
      };
      const choice = json.choices?.[0];
      const source = choice?.delta ?? choice?.message;
      if (!source) return;
      const thinking = source.reasoning_content ?? source.reasoning ?? "";
      if (thinking) {
        callbacks?.onThinking?.(thinking);
        receivedAny = true;
      }
      const chunk = source.content ?? "";
      if (chunk) {
        full += chunk;
        fullEmitted = true;
        callbacks?.onToken?.(chunk);
        if (!receivedAny) callbacks?.onFirstToken?.();
        receivedAny = true;
      }
    } catch {
      /* unvollständige Zeile – ignorieren */
    }
  };

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    if (isSse) {
      let newlineIdx: number;
      while ((newlineIdx = buffer.indexOf("\n")) !== -1) {
        const line = buffer.slice(0, newlineIdx).replace(/\r$/, "");
        buffer = buffer.slice(newlineIdx + 1);
        if (line) {
          sawSseData = true;
          handleSseLine(line);
        }
      }
    }
  }
  if (sawSseData && buffer) handleSseLine(buffer);

  if (!isSse || full === "") {
    // Fallback: nicht gestreamte JSON-Antwort (Server puffert die gesamte Antwort)
    const raw = (buffer + decoder.decode()).trim();
    if (raw) {
      try {
        const json = JSON.parse(raw) as {
          choices?: { message?: { content?: string; reasoning_content?: string; reasoning?: string } }[];
        };
        const msg = json.choices?.[0]?.message;
        const thinking = msg?.reasoning_content ?? msg?.reasoning ?? "";
        if (thinking) callbacks?.onThinking?.(thinking);
        const content = msg?.content ?? "";
        if (content) {
          full = content;
          fullEmitted = true;
          callbacks?.onToken?.(content);
        }
      } catch {
        throw new Error("Unerwartetes Antwortformat vom Modell-Endpunkt.");
      }
    }
  }

  if (fullEmitted && !receivedAny) callbacks?.onFirstToken?.();
  if (!full.trim()) throw new Error("Das Modell hat keine Antwort geliefert.");
  return full;
}

export function buildFixMessages(text: string, issues: Issue[]): ChatMessage[] {
  return [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: buildUserPrompt(text, issues) },
  ];
}
