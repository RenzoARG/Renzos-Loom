# Skills Folder

Habilidades reusable en formato **Agent Skills estándar**. Cada skill es una carpeta con un `SKILL.md` (mayúsculas) que contiene:

- **Frontmatter YAML** (`name` + `description`) — es lo que el agente ve siempre (descubrimiento).
- **Cuerpo en Markdown** — instrucciones, parámetros y ejemplos. Se carga **bajo demanda** leyendo el archivo.

## Estructura

```
src/skills/                       # bundled (empaquetado en el .exe)
  bash-runner/SKILL.md
  file-analyzer/SKILL.md
  ... (ver lista abajo)
```

Más dos raíces externas (en orden de prioridad, la última gana en caso de choque de nombre):

1. `src/skills/` — bundled, viene en el instalador.
2. `skills/` — proyecto (raíz del repo, útil en dev para probar sin rebuild).
3. `%APPDATA%/Renzo's Loom/skills/` — **usuario**, fuera del `.exe`, generada en el primer arranque.
   Acá vuelca el usuario sus skills sin tocar el instalador. Si el nombre coincide con uno bundled,
   **gana el de usuario** (mecanismo oficial de personalización).

## Formato de un skill

```md
---
name: mi-skill
description: Qué hace y cuándo usarla (frase disparadora, en 3ª persona).
---

# Mi Skill

## ¿Cuándo usar?

...instrucciones...

## Parámetros

- `arg` (tipo, default): descripción.

## Ejemplo

```js
mi-skill({ arg: 'valor' })
```
```

Reglas del estándar (agentskills.io):

- `name` = nombre de la carpeta, kebab-case (`a-z`, `0-9`, `-`), 1–64 caracteres.
- `description` = disparadora: qué hace + cuándo usarla. El loader la usa para decidir si cargar la skill.
- `SKILL.md` en **mayúsculas** (es el nombre oficial). El loader acepta `skill.md` como fallback.
- Archivos opcionales dentro de la carpeta: `scripts/` (código ejecutable), `references/` (docs largas), `assets/` (plantillas).

## Cómo se cargan en Renzo's Loom

- `src/context/skills.js` (`loadSkills(roots)`) escanea las tres raíces, deduplica por `name`
  (usuario > proyecto > bundled), parsea frontmatter y crea un catálogo.
- `main.js` genera `%APPDATA%/Renzo's Loom/skills` si no existe, escanea con prioridad y
  inyecta el catálogo (solo name+description) en el system prompt de cada pestaña nueva.
- El cuerpo completo se lee con la tool `read_file` cuando el agente decide usar una skill.
- IPC: `list-skills` / `read-skill` / `reload-skills` / `get-skills-dirs` / `open-skills-folder`
  (ver `preload.js`: `window.loom.listSkills`, `.getSkillsDirs`, `.openSkillsFolder`).

## Skills bundled

Propios de Loom:

- `bash-runner` — Ejecutar comandos bash con seguridad y timeout.
- `file-analyzer` — Analizar archivos y extraer estructura/contenido.
- `project-summary` — Resumir el proyecto actual rápidamente.
- `conversation-browser` — Navegar y buscar en conversaciones guardadas.

Vendorizados (MIT, selección curada compatible con las tools de Loom: `bash`/`read_file`/
`write_file`/`list_dir`/`grep`, sin MCP ni subagentes):

De `addyosmani/agent-skills` (© 2025 Addy Osmani, MIT):

- `api-and-interface-design` — Diseño de APIs e interfaces estables.
- `code-review-and-quality` — Code review multi-eje.
- `code-simplification` — Simplificación sin cambio de comportamiento.
- `debugging-and-error-recovery` — Debugging sistemático por causa raíz.
- `documentation-and-adrs` — ADRs y documentación de decisiones.
- `git-workflow-and-versioning` — Commits atómicos, branches, releases.
- `incremental-implementation` — Cambios en slices finos y verificables.
- `planning-and-task-breakdown` — Descomposición en tareas ordenadas.
- `security-and-hardening` — Hardening OWASP, auditoría, supply-chain (+ `references/hardening-patterns.md`).
- `test-driven-development` — Ciclo red-green-refactor (versión Addy; se descarta la de Superpowers).

De `obra/superpowers` (© 2025 Jesse Vincent, MIT):

- `brainstorming` — Brainstorming antes de trabajo creativo (+ `scripts/`).
- `receiving-code-review` — Recibir feedback de review con rigor técnico.
- `requesting-code-review` — Pedir review antes de mergear.
- `systematic-debugging` — Debugging sistemático antes de proponer fixes.
- `verification-before-completion` — Verificación con evidencia antes de declarar done.
- `writing-plans` — Escribir planes multi-paso.

> Los `.json` viejos (`bash-runner.json`, etc.) fueron migrados a este formato en v0.4.0 y eliminados.

## Excluidos (y por qué)

- `browser-testing-with-devtools` — requiere `chrome-devtools` MCP (Loom no tiene MCP).
- `dispatching-parallel-agents`, `subagent-driven-development`, `executing-plans` — requieren subagentes (Loom no tiene).
- `using-superpowers`, `diagnosing-superpowers`, `using-agent-skills`, `context-engineering`, `writing-skills` — metas (gobernanza de skills dentro de su propio ecosistema).
- `test-driven-development` (Superpowers) — duplicado: se conserva el de Addy.
- `idea-refine`, `interview-me` — solapan con `brainstorming`.
- Demás skills genéricos de Addy no incluidos por catalog bloat (`ci-cd-and-automation`,
  `constraint-driven-development`, `deprecation-and-migration`, `doubt-driven-development`,
  `frontend-ui-engineering`, `observability-and-instrumentation`, `performance-optimization`,
  `shipping-and-launch`, `source-driven-development`, `spec-driven-development`):
  el usuario puede volcarlos en `%APPDATA%/Renzo's Loom/skills/` tal cual desde
  `https://github.com/addyosmani/agent-skills/tree/main/skills` y Loom los descubre.

## Licencias

Ambos repos son MIT. Ver `THIRD-PARTY-NOTICES.md` en esta carpeta para el texto completo
y la atribución por skill.
