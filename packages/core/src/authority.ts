import { fail } from "./errors.js";

/**
 * Un correlativo reservado por la autoridad local.
 *
 * `series` + `number` identifican el documento dentro del vendedor. El número
 * sale del estado proyectado del vault: es determinista y reproducible.
 */
export interface ReservedNumber {
  readonly series: string;
  readonly number: number;
}

/**
 * Quien asigna el siguiente correlativo.
 *
 * Es síncrono a propósito: el único modo soportado por el core es el Personal
 * (un operador, autoridad local en el vault). El modo Conectado quedó FUERA DE
 * ALCANCE por decisión de Eduardo (ADR-001, actualización 2026-09-18): si algún
 * día se retoma, la reserva remota se reintroduce con su propia revisión de
 * diseño y esta firma se re-evalúa.
 */
export interface NumberAuthority {
  readonly mode: "personal";
  reserve(series: string): ReservedNumber;
}

/**
 * Autoridad local: el siguiente numero sale del estado proyectado del vault.
 *
 * Es la unica autoridad del core (modo Personal, un operador). Con varios
 * operadores offline emitirian el mismo correlativo y el conflicto se
 * descubriria despues de haberle entregado el documento al cliente; por eso el
 * modo Conectado (servidor como autoridad) quedo fuera de alcance.
 */
export class LocalNumberAuthority implements NumberAuthority {
  readonly mode = "personal" as const;

  constructor(
    private readonly lastNumberFor: (series: string) => number | undefined,
  ) {}

  reserve(series: string): ReservedNumber {
    if (!series.trim()) fail("authority.no_series", "Se requiere la serie para reservar un correlativo");
    const last = this.lastNumberFor(series);
    return { series, number: (last ?? 0) + 1 };
  }
}