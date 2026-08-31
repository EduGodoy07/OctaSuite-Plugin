import { fail } from "./errors.js";

/**
 * Modo de operacion del vault.
 *
 * `personal`: un solo operador, el journal del vault es la autoridad.
 * `conectado`: varios operadores, la autoridad de los documentos fiscales vive
 *              en el servidor de OctaSuite.
 *
 * La distincion no es cosmetica: determina quien puede asignar un correlativo.
 */
export type OperationMode = "personal" | "conectado";

export interface ReservedNumber {
  readonly series: string;
  readonly number: number;
  /**
   * Comprobante de la reserva emitido por la autoridad. En modo conectado el
   * servidor lo devuelve y se envia de vuelta al confirmar la emision, para que
   * un numero reservado y nunca usado se pueda liberar o auditar.
   */
  readonly token?: string;
}

/**
 * Quien asigna el siguiente correlativo. Es asincrono a proposito: en modo
 * conectado implica una llamada de red, y el modelo de datos no debe cambiar
 * cuando eso pase.
 */
export interface NumberAuthority {
  readonly mode: OperationMode;
  reserve(series: string): Promise<ReservedNumber>;
}

/**
 * Autoridad local: el siguiente numero sale del estado proyectado del vault.
 *
 * Solo es valida con UN operador. Con varios, dos dispositivos offline emitirian
 * el mismo correlativo y el conflicto se descubriria despues de haberle
 * entregado el documento al cliente. Por eso el constructor exige el modo y
 * rechaza construirse en `conectado`: es una barrera de tipo, no un comentario.
 */
export class LocalNumberAuthority implements NumberAuthority {
  readonly mode: OperationMode = "personal";

  constructor(
    private readonly lastNumberFor: (series: string) => number | undefined,
    mode: OperationMode,
  ) {
    if (mode !== "personal") {
      fail(
        "authority.local_in_shared_mode",
        "En modo conectado los correlativos los asigna el servidor: la autoridad local mintaria numeros duplicados",
      );
    }
  }

  async reserve(series: string): Promise<ReservedNumber> {
    if (!series.trim()) fail("authority.no_series", "Se requiere la serie para reservar un correlativo");
    const last = this.lastNumberFor(series);
    return { series, number: (last ?? 0) + 1 };
  }
}

/** Transporte inyectado por el adaptador. El core no conoce `fetch` ni `requestUrl`. */
export type Transport = (path: string, body: unknown) => Promise<unknown>;

/**
 * Autoridad remota: el servidor de OctaSuite reserva el correlativo antes de que
 * el documento exista. Si no hay red, no se emite: es preferible bloquear la
 * emision a entregar un numero que otro operador ya uso.
 */
export class RemoteNumberAuthority implements NumberAuthority {
  readonly mode: OperationMode = "conectado";

  constructor(private readonly transport: Transport) {}

  async reserve(series: string): Promise<ReservedNumber> {
    if (!series.trim()) fail("authority.no_series", "Se requiere la serie para reservar un correlativo");
    const response = await this.transport("documents/reserve-number", { series });
    return parseReservation(response, series);
  }
}

function parseReservation(response: unknown, series: string): ReservedNumber {
  if (typeof response !== "object" || response === null) {
    fail("authority.bad_response", "El servidor no devolvio una reserva de correlativo");
  }
  const data = response as Record<string, unknown>;
  const number = data.number;
  if (typeof number !== "number" || !Number.isInteger(number) || number <= 0) {
    fail("authority.bad_response", `Correlativo invalido devuelto por el servidor: ${String(number)}`);
  }
  const returnedSeries = typeof data.series === "string" ? data.series : series;
  if (returnedSeries !== series) {
    fail("authority.series_mismatch", `El servidor reservo la serie ${returnedSeries}, se pidio ${series}`);
  }
  return {
    series: returnedSeries,
    number,
    ...(typeof data.token === "string" ? { token: data.token } : {}),
  };
}

/**
 * Barrera para cualquier operacion que solo es correcta con un operador.
 * Se llama antes de emitir con autoridad local.
 */
export function assertSingleOperator(mode: OperationMode, operation: string): void {
  if (mode !== "personal") {
    fail(
      "authority.requires_server",
      `${operation} requiere autoridad del servidor en modo conectado`,
    );
  }
}
