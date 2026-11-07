---
name: user-profile
description: Registra notas sobre el usuario en un perfil persistente para mejorar la comunicación. Úsala cuando la conversación revele datos relevantes sobre el usuario (idiomas, experiencia, familiaridad con tópicos, preferencias de comunicación) que deban recordarse, sin registrar datos sensibles ni inferencias débiles.
---

# User Profile

Mantiene un `USER_PROFILE.md` en la carpeta de usuario de Loom (`%APPDATA%/Renzo's Loom/USER_PROFILE.md`, fuera del proyecto) con notas sobre el usuario, basadas en evidencia de la conversación. El objetivo es adaptar idioma, nivel de explicación y ejemplos en sesiones futuras.

> Nunca crees `USER_PROFILE.md` en la raíz del proyecto ni en `src/`: siempre en la carpeta de usuario de la app.

## ¿Cuándo usar?

- El usuario menciona en qué idiomas trabaja o prefiere comunicarse.
- Se infiere (con evidencia) su experiencia previa o stack.
- Se nota su nivel de comprensión de un tópico (explica conceptos, corrige, pregunta desde un nivel básico/avanzado).
- Expresa una preferencia de comunicación: conciso, técnico, con ejemplos, paso a paso, etc.
- Cambia de proyecto, rol o objetivo, y eso afecta cómo ayudarlo.

## Qué registrar

- **Idiomas**: idiomas que habla/lee/escribe, idioma preferido de respuesta.
- **Experiencia**: stack, años o tipo de experiencia mencionadas, proyectos previos.
- **Comprensión por tópico**: tópico, nivel estimado, evidencia breve.
- **Comunicación**: formato preferido, tolerancia a jerga, necesidad de ejemplos.
- **Contexto**: objetivo actual, rol, restricciones (ej. "probando una app desktop en Windows").

## Qué NO registrar

- Datos sensibles: salud, política, religión, orientación, condición socioeconómica, datos de terceros, credenciales, tokens, datos personales exactos (dirección, DNI, etc.).
- Rango etario, género u otros rasgos protegidos inferidos de forma indirecta. Solo si el usuario lo declara explícitamente y es relevante para el tono.
- Inferencias débiles basadas en un solo comentario ambiguo.
- Opiniones o datos que el usuario pidió no guardar.

## Formato

`USER_PROFILE.md` (crear si no existe, editable y borrable por el usuario):

```md
# Perfil de usuario

## Idiomas
- Español (preferido), Inglés técnico

## Experiencia
- Desarrollo desktop (Electron) — explícito, 2026-04-11

## Comprensión por tópico
- Pagos / integraciones: intermedio — preguntó por error de vinculación, 2026-04-11

## Comunicación
- Prefiere respuestas concisas

## Contexto
- Probando Renzo's Loom en Windows

## Notas
- (inferencias con confianza y evidencia; borrar lo que el usuario pida)
```

Cada entrada: `dato — tipo (explícito/inferido), evidencia breve, fecha`.

## Reglas

1. **Evidencia antes que inferencia**: preferir lo explícito. Una inferencia solo se guarda si es fuerte, útil para comunicar mejor y reversible.
2. **Confianza marcada**: `explícito` > `inferido-alto`. Si es dudoso, no se guarda.
3. **No spamear**: no anunciar cada registro. Confirmar brevemente solo si el dato es importante o el usuario pregunta.
4. **Corrección inmediata**: si el usuario contradice una nota, corregirla o borrarla en el acto y confirmar.
5. **Deduplicar y actualizar**: no agregar entradas repetidas; actualizar la existente.
6. **Privacidad**: el perfil es del usuario. Nunca exponerlo en respuestas públicas, commits ni a terceros. Si el usuario pide "assume lo que anotaste", borrarlo.
7. **Relevancia**: registrar solo lo que cambiaría cómo responderías (idioma, nivel, formato). Sin relevancia, no se guarda.

## Parámetros

- `signal` (string): qué reveló la conversación.
- `confidence` (string, default `explícito`): `explícito` | `inferido-alto`. Sin confianza suficiente, descartar.
- `field` (string): `idiomas` | `experiencia` | `comprension` | `comunicacion` | `contexto`.

## Ejemplo

```js
user-profile({ signal: 'responde en español rioplatense, pide resúmenes breves', confidence: 'explícito', field: 'comunicacion' })
// → actualiza USER_PROFILE.md: Comunicación — Español rioplatense, resúmenes breves
```
