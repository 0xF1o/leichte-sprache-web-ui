# Leichte Sprache – Web UI

Eine Web-Oberfläche (nur auf Deutsch), die deutsche Texte auf Konformität mit der
**Leichten Sprache** prüft und die gefundenen Probleme mit einem lokalen,
OpenAI-kompatiblen KI-Modell korrigiert.

## Ablauf

1. **Text einfügen** und *„Analysieren"* klicken → die [Leichte-Sprache-API](https://api.leichte-sprache.ai/)
   prüft den Text. Es werden die Anzahl der Verstöße, eine Liste der Probleme (pro Regel)
   und der Text mit gelb markierten Problemstellen angezeigt.
2. *„Mit KI korrigieren"* → das eingestellte KI-Modell schreibt den Text um.
   Der Output wird **tokenweise gestreamt** und live angezeigt (lokale Modelle können
   langsam sein – es gibt einen Laufzeit-Zeiger und einen Abbrechen-Button).
3. **Vergleich**: Wort-Diff zwischen Original und Korrektur (rot = entfernt, grün = neu).
   Danach kann die Korrektur *erneut analysiert* werden, bis keine Verstöße mehr übrig sind.

## Technik

- **Nur Frontend** (statische Seite, kein Backend): Vite + React + TypeScript + Tailwind CSS 4
- Analyse: `POST https://api.leichte-sprache.ai/analyse?format=full` (direkt aus dem Browser, CORS ist freigegeben);
  die Analyse-URL ist in den Einstellungen anpassbar
- Korrektur: OpenAI-kompatibler `chat/completions`-Endpunkt, Konfiguration über das UI
  (Basis-URL, Modell, API-Schlüssel) – der Schlüssel wird nur direkt an den angegebenen
  Endpunkt gesendet und optional in `localStorage` gemerkt
- Der komplette Prompt (System- und Nutzer-Nachricht) sowie die Antwort des Modells
  können in der Sektion *„Prompt und Konversation mit der KI anzeigen“* eingesehen werden
- Hinweis: Das eigene Modell-Endpunkt muss **CORS** erlauben (z. B.
  `Access-Control-Allow-Origin: *` und das `Authorization`-Header-Right). Die beiden
  Endpunkt `api.leichte-sprache.ai` wurde entsprechend geprüft. Der eigene
  Modell-Endpunkt muss dies ebenfalls erlauben.

## Starten

```bash
npm install
npm run dev        # Entwicklung, Standard: http://localhost:5173
```

Optional Voreinstellungen setzen (siehe `.env.example`):

```bash
cp .env.example .env
```

- `VITE_ANALYSE_URL` – z. B. `https://api.leichte-sprache.ai/analyse?format=full`
- `VITE_LLM_BASE_URL` – z. B. `https://beispiel.de/v1`
- `VITE_LLM_MODEL` – Modellname
- `VITE_LLM_API_KEY` – API-Schlüssel

Alles lässt sich auch zur Laufzeit in der Sektion *„Modell-Einstellungen“* ändern.
Der Button *„Modelle laden“* ruft `GET /v1/models` auf und füllt die Modell-Auswahl.

## Produktion

```bash
npm run build      # erzeugt dist/ (statisch, auf jedem Webserver deploybar)
npm run preview    # lokalen Test der Produktions-Build
```

## Projektstruktur

```
src/
  App.tsx                      # Hauptlogik (Zustandsmaschine: idle → analysing → results → fixing → fixed)
  lib/
    analyse.ts                 # Aufruf der Leichte-Sprache-Analyse-API
    llm.ts                     # Prompt + SSE-Streaming gegen OpenAI-kompatible Endpunkte
    types.ts                   # Typen (Issue, AnalyseResponse, LlmSettings)
  components/
    SettingsPanel.tsx          # Basis-URL / Modell / API-Schlüssel
    IssueList.tsx              # Statistik + Probleme pro Regel
    AnnotatedText.tsx          # Text mit gelb markierten Problemstellen
    DiffView.tsx               # Wort-Diff (rot/gün)
```
