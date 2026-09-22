import {
  type Equipment,
  type EquipmentDraft,
  type EquipmentStatus,
  type EquipmentType,
  type Money,
  type State,
  activePartners,
  bookValue,
  format,
  fromDecimal,
  monthlyDepreciation,
  toIsoDate,
  validateEquipmentDraft,
} from "@octasuite/core";
import { App, Modal, Setting } from "obsidian";

export const EQUIPMENT_TYPE_LABEL: Record<EquipmentType, string> = {
  laptop: "Laptop",
  celular: "Celular",
  tablet: "Tablet",
  monitor: "Monitor",
  otro: "Otro",
};

export const EQUIPMENT_STATUS_LABEL: Record<EquipmentStatus, string> = {
  nuevo: "Nuevo",
  en_uso: "En uso",
  en_reparacion: "En reparación",
  dado_de_baja: "Dado de baja",
};

export interface EquipmentModalOptions {
  readonly existing?: Equipment;
  readonly state: State;
  readonly currency: string;
  readonly locale: string;
  readonly onSubmit: (draft: EquipmentDraft) => Promise<boolean>;
}

/** Convierte un texto opcional vacío a undefined (el dominio rechaza cadenas vacías). */
function optionalText(value: string): string | undefined {
  const trimmed = value.trim();
  return trimmed === "" ? undefined : trimmed;
}

export class EquipmentModal extends Modal {
  private readonly options: EquipmentModalOptions;
  private errorsEl!: HTMLElement;
  private serial: string;
  private type: EquipmentType;
  private brand: string;
  private model: string;
  private imei: string;
  private status: EquipmentStatus;
  private plan: string;
  private planProvider: string;
  private planRenewalDate: string;
  private vendorName: string;
  private vendorPhone: string;
  private purchaseDate: string;
  private costRaw: string;
  private supplier: string;
  private warrantyUntil: string;
  private clientId: string;
  private notes: string;

  constructor(app: App, options: EquipmentModalOptions) {
    super(app);
    this.options = options;
    const eq = options.existing;
    this.serial = eq?.serial ?? "";
    this.type = eq?.type ?? "laptop";
    this.brand = eq?.brand ?? "";
    this.model = eq?.model ?? "";
    this.imei = eq?.imei ?? "";
    this.status = eq?.status ?? "nuevo";
    this.plan = eq?.plan ?? "";
    this.planProvider = eq?.planProvider ?? "";
    this.planRenewalDate = eq?.planRenewalDate ?? "";
    this.vendorName = eq?.vendorName ?? "";
    this.vendorPhone = eq?.vendorPhone ?? "";
    this.purchaseDate = eq?.purchaseDate ?? toIsoDate(new Date());
    this.costRaw = eq?.cost ? String(eq.cost.minor / 100) : "";
    this.supplier = eq?.supplier ?? "";
    this.warrantyUntil = eq?.warrantyUntil ?? "";
    this.clientId = eq?.clientId ?? "";
    this.notes = eq?.notes ?? "";
  }

  override onOpen(): void {
    const { contentEl } = this;
    const { existing } = this.options;
    this.modalEl.addClass("octa-wide-modal");
    contentEl.createEl("h2", { text: existing ? "Editar equipo" : "Registrar equipo" });

    new Setting(contentEl).setName("Serial *").addText((t) =>
      t.setValue(this.serial).onChange((v) => {
        this.serial = v;
      })
    );

    new Setting(contentEl)
      .setName("Tipo")
      .addDropdown((d) => {
        for (const [value, label] of Object.entries(EQUIPMENT_TYPE_LABEL)) d.addOption(value, label);
        d.setValue(this.type).onChange((v) => {
          this.type = v as EquipmentType;
        });
      });

    new Setting(contentEl)
      .setName("Estado")
      .addDropdown((d) => {
        for (const [value, label] of Object.entries(EQUIPMENT_STATUS_LABEL)) d.addOption(value, label);
        d.setValue(this.status).onChange((v) => {
          this.status = v as EquipmentStatus;
        });
      });

    new Setting(contentEl).setName("Marca").addText((t) =>
      t.setValue(this.brand).onChange((v) => {
        this.brand = v;
      })
    );

    new Setting(contentEl).setName("Modelo").addText((t) =>
      t.setValue(this.model).onChange((v) => {
        this.model = v;
      })
    );

    new Setting(contentEl).setName("IMEI").addText((t) =>
      t.setValue(this.imei).onChange((v) => {
        this.imei = v;
      })
    );

    new Setting(contentEl).setName("Cliente").addDropdown((d) => {
      d.addOption("", "— Sin cliente —");
      for (const p of [...activePartners(this.options.state)].sort((a, b) => a.name.localeCompare(b.name))) {
        d.addOption(p.id, p.name);
      }
      d.setValue(this.clientId).onChange((v) => {
        this.clientId = v;
      });
    });

    new Setting(contentEl).setName("Plan").addText((t) =>
      t.setValue(this.plan).onChange((v) => {
        this.plan = v;
      })
    );

    new Setting(contentEl).setName("Proveedor del plan").addText((t) =>
      t.setValue(this.planProvider).onChange((v) => {
        this.planProvider = v;
      })
    );

    new Setting(contentEl).setName("Renovación del plan").setDesc("AAAA-MM-DD").addText((t) =>
      t.setPlaceholder("AAAA-MM-DD").setValue(this.planRenewalDate).onChange((v) => {
        this.planRenewalDate = v;
      })
    );

    new Setting(contentEl).setName("Vendedor").addText((t) =>
      t.setValue(this.vendorName).onChange((v) => {
        this.vendorName = v;
      })
    );

    new Setting(contentEl).setName("Teléfono del vendedor").addText((t) =>
      t.setValue(this.vendorPhone).onChange((v) => {
        this.vendorPhone = v;
      })
    );

    new Setting(contentEl).setName("Proveedor (distribuidor)").addText((t) =>
      t.setValue(this.supplier).onChange((v) => {
        this.supplier = v;
      })
    );

    new Setting(contentEl).setName("Fecha de compra").setDesc("AAAA-MM-DD").addText((t) =>
      t.setPlaceholder("AAAA-MM-DD").setValue(this.purchaseDate).onChange((v) => {
        this.purchaseDate = v;
      })
    );

    new Setting(contentEl).setName("Costo").setDesc(this.options.currency).addText((t) =>
      t.setValue(this.costRaw).onChange((v) => {
        this.costRaw = v;
      })
    );

    new Setting(contentEl).setName("Vencimiento de garantía").setDesc("AAAA-MM-DD").addText((t) =>
      t.setPlaceholder("AAAA-MM-DD").setValue(this.warrantyUntil).onChange((v) => {
        this.warrantyUntil = v;
      })
    );

    new Setting(contentEl).setName("Notas").addTextArea((t) =>
      t.setValue(this.notes).onChange((v) => {
        this.notes = v;
      })
    );

    if (existing) {
      const summary = contentEl.createDiv({ cls: "octa-subtle" });
      const asOf = toIsoDate(new Date());
      const book = bookValue(existing, asOf);
      const perMonth = monthlyDepreciation(existing);
      const parts: string[] = [];
      if (book) parts.push(`Valor en libros: ${format(book, this.options.locale)}`);
      if (perMonth) parts.push(`Depreciación mensual: ${format(perMonth, this.options.locale)}`);
      summary.setText(parts.length > 0 ? parts.join(" · ") : "Sin valor en libros (falta costo o fecha de compra).");
    }

    this.errorsEl = contentEl.createDiv({ cls: "octa-form-errors" });

    new Setting(contentEl)
      .addButton((b) =>
        b.setButtonText("Cancelar").onClick(() => {
          this.close();
        })
      )
      .addButton((b) =>
        b
          .setButtonText(existing ? "Guardar cambios" : "Guardar")
          .setCta()
          .onClick(() => {
            void this.submit();
          })
      );
  }

  private async submit(): Promise<void> {
    this.errorsEl.empty();
    const problems: string[] = [];
    const trimmedCost = this.costRaw.trim();
    let cost: Money | undefined;
    if (trimmedCost !== "") {
      try {
        cost = fromDecimal(trimmedCost, this.options.currency);
      } catch {
        problems.push(`Costo inválido: «${trimmedCost}».`);
      }
    }
    const draft: EquipmentDraft = {
      type: this.type,
      serial: this.serial.trim(),
      status: this.status,
      brand: optionalText(this.brand),
      model: optionalText(this.model),
      imei: optionalText(this.imei),
      plan: optionalText(this.plan),
      planProvider: optionalText(this.planProvider),
      planRenewalDate: optionalText(this.planRenewalDate),
      vendorName: optionalText(this.vendorName),
      vendorPhone: optionalText(this.vendorPhone),
      purchaseDate: optionalText(this.purchaseDate),
      supplier: optionalText(this.supplier),
      warrantyUntil: optionalText(this.warrantyUntil),
      clientId: this.clientId === "" ? undefined : this.clientId,
      notes: optionalText(this.notes),
      ...(cost !== undefined ? { cost } : {}),
    };
    for (const problem of validateEquipmentDraft(draft)) problems.push(problem.message);
    if (problems.length > 0) {
      const list = this.errorsEl.createEl("ul");
      for (const message of problems) list.createEl("li", { text: message });
      return;
    }
    if (await this.options.onSubmit(draft)) this.close();
  }
}