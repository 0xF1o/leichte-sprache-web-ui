/// <reference types="vite/client" />

/**
 * Build-Zeit-Variablen (envPrefix "LSWUI_" in vite.config.ts).
 * Hinweis: Diese Werte landen im öffentlichen JS-Bundle – nichts Vertrauliches einbauen!
 */
interface ImportMetaEnv {
  /** Vollständige URL der Analyse-API, z. B. https://api.leichte-sprache.ai/analyse?format=full */
  readonly LSWUI_ANALYSE_URL?: string;
  /** OpenAI-kompatible Basis-URL (endet auf /v1) */
  readonly LSWUI_BASE_URL?: string;
  /** Modellname als Voreinstellung */
  readonly LSWUI_MODEL?: string;
  /** API-Schlüssel als Voreinstellung (NUR für lokale Entwicklung verwenden) */
  readonly LSWUI_API_KEY?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
