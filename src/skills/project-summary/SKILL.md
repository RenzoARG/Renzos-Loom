---
name: project-summary
description: Genera un resumen rápido del proyecto actual (estructura, dependencias, scripts). Úsala al arrancar una sesión nueva o cuando el usuario pide contexto sin leer todo el código.
---

# Project Summary

Genera un resumen del proyecto actual incluyendo estructura principal, archivos clave, dependencias y estado actual. Útil para tener contexto rápidamente sin leer todo el código.

## ¿Cuándo usar?

- Sesión nueva o pestaña recién creada: antes de tocar código.
- El usuario pregunta "¿qué hace este proyecto?" o "resumime el repo".
- Hay que decidir dónde está algo (scripts, config, entry points) sin explorar a mano.

## Reglas

- No leas archivos enteros innecesariamente: listá directorios, `package.json`, `README.md` y los entry points.
- Incluí: stack, estructura de carpetas, scripts disponibles, dependencias clave y estado (git, build).
- Si el proyecto es Electron como Renzo's Loom, mencioná `src/main`, `src/renderer`, `src/tools`, `src/context` y `src/skills`.

## Parámetros

- `focusAreas` (optional, array<string>, default `["estructura", "dependencias"]`): Áreas en las que enfocarse: `estructura`, `dependencias`, `scripts`, `configuración`, `conversaciones`.
- `maxFiles` (optional, integer, default 10): Número máximo de archivos a inspeccionar.

## Ejemplo

```js
project-summary({ focusAreas: ['estructura', 'dependencias'], maxFiles: 5 })
```
