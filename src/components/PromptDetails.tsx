import type { ChatMessage } from "../lib/llm";

interface Props {
  conversation: ChatMessage[];
  showPrompt: boolean;
  onToggle: (open: boolean) => void;
  model: string;
  reasoningEffort: string;
  thinkingText: string;
  fixedText: string;
  /** true, während gerade eine Korrektur-Runde läuft */
  fixing: boolean;
}

/** Aufklappbare Ansicht von Prompt und Konversation mit der KI. */
export function PromptDetails({ conversation, showPrompt, onToggle, model, reasoningEffort, thinkingText, fixedText, fixing }: Props) {
  return (
    <details className="mt-4 rounded-lg border border-slate-800 bg-slate-950" open={showPrompt} onToggle={(e) => onToggle((e.target as HTMLDetailsElement).open)}>
      <summary className="cursor-pointer select-none p-3 text-sm font-semibold text-slate-300">
        Prompt und Konversation mit der KI anzeigen
      </summary>
      <div className="space-y-4 px-3 pb-3">
        <p className="text-xs text-slate-500">
          Anfrage-Parameter: <code className="text-slate-400">model={model}</code>
          {reasoningEffort && (
            <>
              {" "}
              <code className="text-slate-400">reasoning_effort={reasoningEffort}</code>
            </>
          )}
        </p>
        {conversation.map((msg, i) => {
          const label =
            msg.role === "system" ? "System-Prompt" : msg.role === "user" ? "Nutzer-Prompt" : "Antwort des Modells";
          return (
            <div key={i}>
              <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</p>
              {msg.content && (
                <pre className="whitespace-pre-wrap rounded-lg border border-slate-700 bg-slate-900 p-3 text-sm text-slate-200">{msg.content}</pre>
              )}
              {msg.role === "assistant" && !msg.content && fixing && (
                <p className="text-sm text-slate-500">(läuft noch – siehe Live-Fenster unten)</p>
              )}
            </div>
          );
        })}
        {thinkingText && (
          <div>
            <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-amber-400">Denken des Modells (Thinking)</p>
            <pre className="max-h-64 overflow-y-auto whitespace-pre-wrap rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-200">
              {thinkingText}
            </pre>
          </div>
        )}
        <div>
          <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">
            Antwort des Modells {fixing && "(läuft noch)"}
          </p>
          <pre className="whitespace-pre-wrap rounded-lg border border-slate-700 bg-slate-900 p-3 text-sm text-slate-200">
            {fixing ? fixedText || "(Noch keine Antwort – siehe Live-Fenster unten)" : fixedText || "(keine Antwort erhalten)"}
          </pre>
        </div>
      </div>
    </details>
  );
}
