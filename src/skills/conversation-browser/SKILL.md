---
name: conversation-browser
description: Navega y busca en las conversaciones guardadas. Úsala para reencontrar discusiones anteriores, continuar hilos o aprender del historial.
---

# Conversation Browser

Navega y busca en conversaciones guardadas. Útil para reencontrar información de discusiones anteriores, continuar hilos o aprender del historial.

## ¿Cuándo usar?

- El usuario dice "la otra vez hablamos de…", "¿te acordás cuando…?" o "buscá en mis conversaciones".
- Hay que listar sesiones guardadas o recuperar una conversación cerrada.
- Se necesita contexto de un hilo sin reabrir la pestaña.

## Reglas

- `list` y `recent` no necesitan parámetros: son el punto de partida.
- `search` busca por texto en el contenido de las sesiones (no en el nombre solo).
- `load` requiere `conversationId` (el id de la sesión, no el título).
- Nunca inventes IDs: si el usuario no lo provee, listá primero.

## Parámetros

- `action` (required, string, default `list`): Acción a realizar: `list`, `search`, `load`, `recent`.
- `pattern` (optional, string): Patrón de búsqueda (solo para `action: 'search'`).
- `conversationId` (optional, string): ID de conversación específica (solo para `action: 'load'`).

## Ejemplo

```js
conversation-browser({ action: 'search', pattern: 'Mercado Pago' })
```
