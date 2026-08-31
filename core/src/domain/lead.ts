/**
 * Prospectos (CRM) — dominio puro.
 *
 * Un prospecto ("lead") representa un contacto comercial que aún no es
 * factura. El pipeline tiene etapas predefinidas que se pueden ordenar
 * manualmente.
 */

// ── Etapas del pipeline ──────────────────────────────────────────────

export const PIPELINE_STAGES = [
  "nuevo",
  "contactado",
  "calificado",
  "propuesta",
  "negociacion",
  "ganado",
  "perdido",
] as const;

export type Stage = (typeof PIPELINE_STAGES)[number];

export const STAGE_LABEL: Record<Stage, string> = {
  nuevo: "Nuevo",
  contactado: "Contactado",
  calificado: "Calificado",
  propuesta: "Propuesta",
  negociacion: "Negociación",
  ganado: "Ganado",
  perdido: "Perdido",
};

/** Etapas activas (excluye ganado/perdido que son terminales). */
export const ACTIVE_STAGES = PIPELINE_STAGES.filter(
  (s): s is (typeof PIPELINE_STAGES)[number] & "ganado" => s !== "ganado" && s !== "perdido",
) as readonly Stage[];

// ── Fuentes de contacto ──────────────────────────────────────────────

export const LEAD_SOURCES = [
  "referido",
  "sitio_web",
  "llamada",
  "correo",
  "red_social",
  "evento",
  "otro",
] as const;

export type Source = (typeof LEAD_SOURCES)[number];

export const SOURCE_LABEL: Record<Source, string> = {
  referido: "Referido",
  sitio_web: "Sitio web",
  llamada: "Llamada",
  correo: "Correo",
  red_social: "Red social",
  evento: "Evento",
  otro: "Otro",
};

// ── Modelo ───────────────────────────────────────────────────────────

export type LeadStatus = "active" | "won" | "lost";

export interface LeadActivity {
  /** @example "2026-08-25T14:00:00Z" */
  at: string;
  /** @example "Llamada de seguimiento" */
  description: string;
  /** @example "phone" */
  type: string;
}

export interface Lead {
  id: string;
  /** Nombre del prospecto o empresa. */
  name: string;
  /** Nombre de la persona de contacto (si aplica). */
  contactName: string;
  email: string;
  phone: string;
  /** Empresa / organización. */
  company: string;
  stage: Stage;
  source: Source;
  /** Valor estimado en centavos (0 si no se conoce). */
  estimatedValue: number;
  /** Responsable del seguimiento. */
  owner: string;
  /** Notas internas. */
  notes: string;
  status: LeadStatus;
  activities: LeadActivity[];
  archived: boolean;
  createdAt: string;
  updatedAt: string;
}

/** Campos editables al crear/editar un lead. */
export interface LeadDraft {
  name: string;
  contactName?: string;
  email?: string;
  phone?: string;
  company?: string;
  stage?: Stage;
  source?: Source;
  estimatedValue?: number;
  owner?: string;
  notes?: string;
}

// ── Validación ───────────────────────────────────────────────────────

export interface ValidationError {
  field: string;
  message: string;
}

export function validateLeadDraft(draft: LeadDraft): ValidationError[] {
  const errors: ValidationError[] = [];

  if (!draft.name || draft.name.trim() === "") {
    errors.push({ field: "name", message: "El nombre es obligatorio." });
  }

  if (draft.email && draft.email.trim() !== "") {
    const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRe.test(draft.email.trim())) {
      errors.push({ field: "email", message: "El correo no tiene un formato válido." });
    }
  }

  if (draft.estimatedValue !== undefined && draft.estimatedValue < 0) {
    errors.push({ field: "estimatedValue", message: "El valor estimado no puede ser negativo." });
  }

  if (draft.stage && !PIPELINE_STAGES.includes(draft.stage)) {
    errors.push({ field: "stage", message: `Etapa inválida: ${draft.stage}` });
  }

  if (draft.source && !LEAD_SOURCES.includes(draft.source)) {
    errors.push({ field: "source", message: `Fuente inválida: ${draft.source}` });
  }

  return errors;
}
