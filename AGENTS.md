# AGENTS.md — Reglas y Contexto para OctaSuite Lite (Antigravity & Agents)

> Adaptado desde `~/.config/opencode/AGENTS.md` y las directivas de arquitectura del ecosistema.
> Aplica para todo agente de desarrollo en `octasuite-obsidian`.

---

## 👤 Perfil y Directivas Generales

- **Usuario:** Eduardo Godoy (Founder / Full-stack Developer / Architect).
- **Idioma:** Responder SIEMPRE en español (es-CL / latinoamericano).
- **Hardware dev:** macOS Ventura (Intel x86_64, 8GB RAM).
  - *Restricción de eficiencia:* Evitar procesos pesados innecesarios, loops descontrolados o consumo excesivo de memoria. Nunca matar procesos de Colima/Docker en uso sin confirmación explícita.
- **Aislamiento de IP y Marcas:**
  - `HighSoft Technologies` = razón social / autoría.
  - `OctaSuite` = marca del producto ERP y micro-ERP.
  - **REGLA CRÍTICA:** No mezclar IP ni datos entre clientes (ej. GoldenLeaf/HighSoftTech ≠ DeLoAlto/Systechpro).

---

## 🏛️ Arquitectura del Proyecto (`octasuite-obsidian`)

1. **Monorepo (`pnpm` / `npm workspaces`):**
   - `packages/core`: Dominio puro, agnóstico de Obsidian, testeado con Vitest.
   - `packages/obsidian-plugin`: Adaptador de UI para Obsidian (32 componentes y vistas).
2. **Event Sourcing Inmutable:**
   - La verdad reside únicamente en el journal append-only (`octasuite-data/journal/{companyId}/*.jsonl`).
   - El estado en memoria (`State` en `store.ts`) es una proyección determinista y reconstruible.
   - Si un evento viola una regla o invariante, se rechaza (`RejectedEvent`), nunca se aborta en silencio.
3. **Aritmética Monetaria:**
   - Montos siempre en enteros de unidad mínima (`minor: number, currency: CurrencyCode`).
   - Cero flotantes para dinero. Redondeo `HALF-UP` bancario idéntico a OctaSuite PHP.
4. **Modelo de Autoridad (ADR-001):**
   - **Modo Personal (vigente):** 1 operador. Autoridad local en el vault vía `LocalNumberAuthority`.
   - **Modo Conectado (futuro):** Varios operadores contra servidor OctaSuite vía `RemoteNumberAuthority`.
5. **Multi-Empresa:**
   - **1 Vault = 1 Grupo Empresarial.** Clientes distintos / auditorías van en vaults separados.
   - Journals particionados por empresa (`journal/{companyId}/`).
   - Proyecciones independientes en memoria (`states[companyId]`) para evitar colisión de correlativos y estados.
   - Invariante de ubicación principal: `PRIMARY_LOCATION_ID = "main"` es inmutable y no se puede archivar (`inventory.immutable_primary`).

---

## 🛡️ Disciplina de Verificación y Calidad

1. **TDD Estricto (RED → GREEN):**
   - Ningún bug fix o cambio de dominio se considera completado sin:
     (a) Escribir primero un test de regresión que falle (RED).
     (b) Implementar el cambio hasta ponerlo en verde (GREEN).
     (c) Verificar que la suite completa pase (268+ tests en verde).
2. **Compilación y Tipos:**
   - `npm run typecheck` (`tsc -b packages/core packages/obsidian-plugin`) debe terminar con 0 errores bajo configuración TypeScript estricta (`noUncheckedIndexedAccess`).
3. **Build y Despliegue:**
   - `npm run build` debe generar `packages/obsidian-plugin/main.js`.
   - Después de cada cambio visible en UI o almacenamiento, ejecutar `npm run deploy` para actualizar el vault de Obsidian.
4. **Compuerta de Revisión (Code Review Gate):**
   - Todo cambio no trivial debe ser sometido a revisión de invariantes y edge cases antes de considerarse terminado.
5. **Control de Versiones (Git):**
   - Repositorio remoto: `https://github.com/EduGodoy07/OctaSuite-Plugin`.
   - Mirror local de git: `/tmp/octasuite-plugin-stage`.
   - **Regla:** Solo hacer commit y push con confirmación explícita de Eduardo.

---

## 📋 Comandos Rápidos

```bash
npm test              # Correr suite completa de Vitest
npm run typecheck     # Chequeo estricto de tipos en ambos paquetes
npm run build         # Bundle de producción de main.js
npm run deploy        # Compilar e instalar directo en el vault activo de Obsidian
```
