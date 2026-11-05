---
name: file-analyzer
description: Analiza un archivo y devuelve su estructura, contenido destacado o estadísticas. Úsala cuando el usuario pide entender código, logs o cualquier archivo de texto sin leerlo entero.
---

# File Analyzer

Analiza un archivo y retorna información sobre su estructura, contenido destacado o tipos de datos. Útil para entender código, logs, o cualquier archivo de texto.

## ¿Cuándo usar?

- El usuario pasa una ruta y pide qué hace, cómo está organizado o un resumen.
- Hay que auditar un log o un archivo grande sin volcarlo entero en el chat.
- Necesitás la estructura (funciones, clases, secciones) antes de editar.

## Reglas

- Si el archivo es binario o muy grande, resumí y citá líneas puntuales; no pegues todo el contenido.
- Si es imagen, usá `read_file` con la tool de imágenes (ya lo hace `tools/index.js`); esta skill es para texto/código.
- Respetá `maxLines`: por defecto 100, más si el usuario lo pide.

## Parámetros

- `path` (required, string): Ruta del archivo a analizar.
- `focus` (optional, string, default `contenido`): Área de enfoque: `estructura`, `contenido`, `resumen`, `estadisticas`.
- `maxLines` (optional, integer, default 100): Número máximo de líneas a leer.

## Ejemplo

```js
file-analyzer({ path: 'src/main/main.js', focus: 'estructura', maxLines: 50 })
```
