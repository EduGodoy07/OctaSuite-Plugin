import { DEFAULT_CURRENCY } from "@octasuite/core";
import { DEFAULT_COMPANY_ID } from "./storage/vault-journal.js";

export interface OctaSuiteSettings {
  /** Carpeta del vault donde vive el journal y los catalogos. */
  dataFolder: string;
  /**
   * Empresa activa: define la particion del journal (`journal/{companyId}/`)
   * y la moneda base funcional para documentos nuevos. Es la PRIMERA de
   * `activeCompanyIds` (la primaria); se mantiene por compatibilidad con v1.
   */
  activeCompanyId: string;
  /**
   * Empresas seleccionadas, en orden de selección. La PRIMERA es la primaria:
   * destino de escrituras (quick add, facturas, inventario...) y base del
   * journal que se lee. Las demás son empresas de solo-lectura cuyos
   * indicadores y reportes se consolidan en launcher/reports.
   */
  activeCompanyIds: string[];
  currency: string;
  /** Tasa de IVA por defecto en porcentaje. En Guatemala, 12. */
  defaultTaxRate: number;
  invoiceSeries: string;
  /** Forma de pago preseleccionada al cobrar. */
  defaultPaymentMethod: string;
  invoiceNumberPadding: number;
  locale: string;
  /** Dónde abre OctaSuite: área principal o panel lateral derecho. */
  openLocation: "main" | "sidebar";
  /** Emitir una nota markdown por documento fiscal, enlazable desde el vault. */
  writeInvoiceNotes: boolean;
  invoiceNotesFolder: string;

  // ── Empresa (recibos e impresiones) ──────────────────────────────────────
  /** Nombre comercial de la empresa que aparece en los recibos. */
  companyName: string;
  /** NIT o identificación fiscal de la empresa. */
  companyTaxId: string;
  /** Dirección física de la empresa. */
  companyAddress: string;
  /** Teléfono de contacto de la empresa. */
  companyPhone: string;
  /** Email de contacto de la empresa. */
  companyEmail: string;
  /**
   * Ruta relativa al vault para el logo de la empresa (ej: "octasuite-data/logo.png").
   * Si está vacío, el recibo se renderiza sin logo.
   */
  companyLogo: string;
  /** Pie de página opcional para los recibos. */
  receiptFooter: string;
}

export const DEFAULT_SETTINGS: OctaSuiteSettings = {
  dataFolder: "octasuite-data",
  activeCompanyId: DEFAULT_COMPANY_ID,
  activeCompanyIds: [DEFAULT_COMPANY_ID],
  currency: DEFAULT_CURRENCY,
  defaultTaxRate: 12,
  invoiceSeries: "A",
  defaultPaymentMethod: "Efectivo",
  invoiceNumberPadding: 4,
  locale: "es-GT",
  openLocation: "main",
  writeInvoiceNotes: true,
  invoiceNotesFolder: "OctaSuite/Facturas",
  companyName: "",
  companyTaxId: "",
  companyAddress: "",
  companyPhone: "",
  companyEmail: "",
  companyLogo: "",
  receiptFooter: "¡Gracias por su compra!",
};
