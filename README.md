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
- Hinweis: Der eigene Modell-Endpunkt muss **CORS** erlauben (z. B.
  `Access-Control-Allow-Origin: *` und `Authorization` in `Access-Control-Allow-Headers`).
  Für `api.leichte-sprache.ai` ist dies entsprechend freigegeben.

## Starten

```bash
npm install
npm run dev        # Entwicklung, Standard: http://localhost:5173
```

Optional Voreinstellungen setzen (siehe `.env.example`):

```bash
cp .env.example .env
```

- `LSWUI_ANALYSE_URL` – z. B. `https://api.leichte-sprache.ai/analyse?format=full`
- `LSWUI_BASE_URL` – z. B. `https://beispiel.de/v1`
- `LSWUI_MODEL` – Modellname
- `LSWUI_API_KEY` – API-Schlüssel (NUR für die lokale Entwicklung – siehe Warnung oben unter Produktion)

(Vite wird über `envPrefix: "LSWUI_"` konfiguriert, damit diese Variablen an die App übergeben werden.)

> **Sicherheit:** Vite baut alle `LSWUI_*`-Werte zur Build-Zeit in das
> öffentliche, statische JS-Bundle ein. Das Bundle sehen alle Besucher der Seite.
> Deshalb nimmt der Docker-Build **keinen** `LSWUI_API_KEY` an – jeder Benutzer gibt
> seinen Schlüssel zur Laufzeit in der Einstellungen-Sektion ein (Speicherung
> optional, nur im eigenen Browser).

Alles lässt sich auch zur Laufzeit in der Sektion *„Modell-Einstellungen“* ändern.
Der Button *„Modelle laden“* ruft `GET /v1/models` auf und füllt die Modell-Auswahl.

## Produktion

```bash
npm run build      # erzeugt dist/ (statisch, auf jedem Webserver deploybar)
npm run preview    # lokalen Test des Produktions-Builds
```

### Docker / Docker Compose

```bash
docker compose up --build
```

Die App läuft danach unter `http://localhost:8087` (Port über `LSWUI_PORT` änderbar).
Optional Voreinstellungen zum Build-Zeit einbauen (werden im Bundle sichtbar, siehe oben):

```bash
LSWUI_MODEL=mein-modell docker compose up --build
```

Der Container nutzt `nginxinc/nginx-unprivileged` (läuft ohne Root-Berechtigung,
lauscht intern auf Port 8080) und hat einen eingebauten Healthcheck.

## Projektstruktur

```
src/
  App.tsx                      # Hauptlogik (Zustandsmaschine: idle → analysing → results → fixing → fixed)
  main.tsx                     # React-Einstiegspunkt
  index.css                    # Tailwind-CSS-Einstiegspunkt
  lib/
    analyse.ts                 # Aufruf der Leichte-Sprache-Analyse-API (+ Verbindungs-Timeout-Helfer)
    llm.ts                     # Prompt + SSE-Streaming, Regeldaten
    types.ts                   # Typen (Issue, AnalyseResult, AppSettings, …)
  components/
    SettingsPanel.tsx          # Analyse-URL / Basis-URL / Modell / API-Schlüssel
    IssueList.tsx              # Statistik + Probleme pro Regel
    AnnotatedText.tsx          # Text mit gelb markierten Problemstellen
    AnnotatedMarkers.tsx       # Rendern des annotierten Texts (format=annotated_text)
    DiffView.tsx               # Wort-Diff (rot/grün)
```
