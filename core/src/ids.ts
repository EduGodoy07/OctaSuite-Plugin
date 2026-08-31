/** Reloj inyectable: los tests no dependen de la hora real. */
export type Clock = () => Date;
export type Random = () => string;

export const systemClock: Clock = () => new Date();

export const systemRandom: Random = () => {
  const g = globalThis as { crypto?: { randomUUID?: () => string } };
  if (typeof g.crypto?.randomUUID === "function") {
    return g.crypto.randomUUID().replace(/-/g, "").slice(0, 8);
  }
  return Math.random().toString(36).slice(2, 10).padEnd(8, "0");
};

function pad(n: number, width = 2): string {
  return n.toString().padStart(width, "0");
}

/**
 * Id ordenable y legible: `exp_20260824T091500_a1b2c3d4`.
 * El prefijo identifica la entidad, el timestamp permite ordenar por texto y el
 * sufijo aleatorio evita colisiones entre dispositivos que escriben offline.
 */
export function generateId(prefix: string, clock: Clock = systemClock, random: Random = systemRandom): string {
  const d = clock();
  const stamp = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}T${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
  return `${prefix}_${stamp}_${random()}`;
}
