/**
 * Contratos das integrações externas do AppCinema.
 *
 * Apenas o provedor de metadados (TMDB) está implementado nesta entrega.
 * Os demais adaptadores existem como contrato para as fases seguintes e NÃO
 * devem ser simulados como funcionais na interface.
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

export const importAiProvider: ImportAiProvider = {
  id: "pending",
  status: () => "not_configured",
};

export const trackerProvider: TrackerProvider = {
  id: "pending",
  status: () => "not_configured",
};

export const tvCompanionProvider: TvCompanionProvider = {
  id: "nuvio",
  status: () => "not_configured",
};
