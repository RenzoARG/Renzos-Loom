---
name: bash-runner
description: Ejecuta un comando de shell de forma segura con timeout y cancelación. Úsala cuando el usuario pide correr comandos, listar directorios, buscar texto o automatizar algo en la terminal.
---

# Bash Runner

Ejecuta un comando de shell de forma segura, sin bloquear a las demás pestañas.

## ¿Cuándo usar?

- El usuario pide ejecutar algo en la terminal.
- Hace falta listar un directorio, buscar texto, compilar, testear o correr un script.
- Hay que combinar varios comandos en una sola línea (p. ej. `ls -la src/`).

## Reglas

- **Timeout por defecto: 120000 ms (120 s)**. Si el comando es un servidor o algo que no termina, no lo ejecutes en primer plano; informale al usuario.
- Sin stdin: un comando que espera input de teclado no queda esperando; falla o sigue vacío.
- Si el comando supera el timeout o el usuario detiene la pestaña, todo el árbol de procesos se cancela (`taskkill /T` en Windows).
- No volver a usar `execSync` para `bash` en la app de escritorio: congela todas las pestañas. Usar `runBashAsync()` (ya es lo que hace la tool `bash`).

## Parámetros

- `command` (required, string): El comando bash a ejecutar.
- `timeoutMs` (optional, integer, default 120000): Timeout en milisegundos. Usa el valor global si no se especifica.

## Ejemplo

```js
bash-runner({ command: 'ls -la src/' })
```
