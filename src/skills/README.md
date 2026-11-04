# Skills Folder

Habilidades reusable que la IA puede descubrir y usar. Cada skill es un archivo con metadatos que describen:
- `name`: Nombre de la habilidad
- `description`: Qué hace y cuándo usarla
- `parameters`: Parámetros que acepta
- `example`: Ejemplo de uso

Las skills se auto-descubren cuando están en esta carpeta. La IA puede sugerir usarlas cuando el contexto lo requiere.

## Estructura de una skill

Cada skill es un archivo `.json` con este formato:

```json
{
  "name": "Nombre de la habilidad",
  "description": "Descripción de qué hace",
  "parameters": {
    "type": "object",
    "properties": { ... },
    "required": [ ... ]
  },
  "example": "Ejemplo de llamada"
}
```

## Skills disponibles

- [`bash-runner.json`](#bash-runner) - Ejecutar comandos bash con seguridad y timeout
- [`file-analyzer.json`](#file-analyzer) - Analizar archivos y extraer información destacada
- [`project-summary.json`](#project-summary) - Resumir el proyecto actual rápidamente
- [`conversation-browser.json`](#conversation-browser) - Navegar y buscar en conversaciones guardadas

---

### bash-runner
Ejecuta un comando de shell de forma segura con timeout y cancelación. Útil para comandos de sistema, lecturas de directorio, búsquedas de texto, etc.

**Parámetros:**
- `command` (required): El comando bash a ejecutar
- `timeoutMs` (optional): Timeout en milisegundos (default: 120000)

**Ejemplo:** `bash-runner({ command: 'ls -la src/' })`

---

### file-analyzer
Analiza un archivo y retorna información sobre su estructura, contenido destacado, o tipos de datos. Útil para entender código, logs, o cualquier archivo de texto.

**Parámetros:**
- `path` (required): Ruta del archivo a analizar
- `focus` (optional): Área de enfoque: 'estructura', 'contenido', 'resumen', 'estadisticas' (default: 'contenido')
- `maxLines` (optional): Número máximo de líneas a leer (default: 100)

**Ejemplo:** `file-analyzer({ path: 'src/main/main.js', focus: 'estructura', maxLines: 50 })`

---

### project-summary
Genera un resumen del proyecto actual incluyendo estructura principal, archivos clave, dependencias y estado actual. Útil para que la IA tenga contexto rápidamente sin leer todo el código.

**Parámetros:**
- `focusAreas` (optional): Áreas en las enfocarse: ['estructura', 'dependencias', 'scripts', 'configuración', 'conversaciones'] (default: ['estructura', 'dependencias'])
- `maxFiles` (optional): Número máximo de archivos a inspeccionar (default: 10)

**Ejemplo:** `project-summary({ focusAreas: ['estructura', 'dependencias'], maxFiles: 5 })`

---

### conversation-browser
Navega y busca en conversaciones guardadas. Útil para reencontrar información de discusiones anteriores, continuar hilos o aprender del historial.

**Parámetros:**
- `action` (required): 'list', 'search', 'load', 'recent'
- `pattern` (optional): Patrón de búsqueda (solo para action: 'search')
- `conversationId` (optional): ID de conversación específica (solo para action: 'load')

**Ejemplo:** `conversation-browser({ action: 'search', pattern: 'Mercado Pago' })`