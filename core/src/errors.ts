/** Error de regla de dominio. Nunca se lanza por fallas de I/O ni de UI. */
export class DomainError extends Error {
  constructor(
    message: string,
    readonly code: string,
  ) {
    super(message);
    this.name = "DomainError";
  }
}

export function fail(code: string, message: string): never {
  throw new DomainError(message, code);
}
