/**
 * Contratos das integrações externas do AppCinema.
 *
 * TMDB (metadados) e Gemini (análise de importação, server-side em ai.functions.ts)
 * estão implementados. Tracker e TV seguem só como contrato e NÃO devem ser
 * simulados como funcionais na interface.
 */

export type ProviderStatus = "ready" | "not_configured" | "unavailable";

export interface MetadataProvider {
  readonly id: string;
  search(query: string): Promise<unknown>;
  details(mediaType: "movie" | "tv", id: number): Promise<unknown>;
}

export interface ImportAiProvider {
  readonly id: string;
  status(): ProviderStatus;
}

export interface TrackerProvider {
  readonly id: string;
  status(): ProviderStatus;
}

export interface TvCompanionProvider {
  readonly id: string;
  status(): ProviderStatus;
}

/** Client-side descriptor; real status comes from getAiStatus (depends on GEMINI_API_KEY). */
export const importAiProvider: ImportAiProvider & { serverFn: "analyzeImport" } = {
  id: "gemini",
  serverFn: "analyzeImport",
  status: () => "unavailable",
};

export const trackerProvider: TrackerProvider = {
  id: "pending",
  status: () => "not_configured",
};

export const tvCompanionProvider: TvCompanionProvider = {
  id: "nuvio",
  status: () => "not_configured",
};
