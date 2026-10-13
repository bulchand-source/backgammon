# Backgammon para dos

Backgammon para dos jugadores en el mismo dispositivo, con las reglas del estándar internacional.
Es HTML, CSS y JavaScript sin dependencias ni compilación. Se puede instalar como app en iPhone,
iPad y Android (PWA) y funciona sin conexión.

**Jugar:** <https://bulchand-source.github.io/backgammon/>

## Jugar en el ordenador

Abre `index.html` en el navegador. También puedes servir la carpeta:

```bash
python -m http.server 8765
```

y entrar en <http://localhost:8765>.

## Instalar en iPhone o iPad

1. Publica la carpeta en una web con HTTPS (el modo sin conexión de iOS lo exige). Cualquiera de estas opciones es gratuita:
   - **Netlify Drop**: arrastra la carpeta del proyecto a <https://app.netlify.com/drop>.
   - **GitHub Pages**: sube el proyecto a un repositorio y activa Pages en *Settings → Pages*.
   - **Cloudflare Pages**: crea un proyecto y sube la carpeta.
2. En el iPhone, abre la dirección en Safari.
3. Pulsa **Compartir** → **Añadir a pantalla de inicio**.

La app se abre a pantalla completa con su icono, guarda la partida y funciona sin conexión.
En horizontal el tablero ocupa toda la altura de la pantalla.

Para probar sin publicar, en un Mac con Xcode puedes abrir el simulador de iOS (*Xcode → Open Developer Tool → Simulator*),
abrir la dirección en Safari y añadirla a la pantalla de inicio de la misma forma.

### Publicar una versión nueva

Cambia `VERSION` en `sw.js` (por ejemplo, de `v1` a `v2`) cada vez que publiques cambios. Las apps instaladas
descargan la versión nueva en segundo plano y la usan a partir del siguiente arranque.

## Qué incluye

- Posición inicial, tirada de salida y alternancia de turnos.
- Solo permite jugadas legales: entrar desde la barra, puntas bloqueadas, uso obligatorio de ambos dados, el dado mayor cuando solo se puede jugar uno, y las reglas para sacar fichas.
- Cubo de doblaje (hasta 64), gammon y backgammon.
- Partidas a N puntos con regla Crawford, o sin límite con regla Jacoby opcional.
- Abandono con sencilla, gammon o backgammon.
- Deshacer dentro del turno, movimientos combinados con los dos dados, anotación estándar (`24/18* 13/9`) y recuento de pips.
- La partida se guarda en `localStorage`.

## Estructura

| Archivo | Contenido |
| --- | --- |
| `js/engine.js` | Motor de reglas sin DOM: posición, movimientos legales, cubo, puntuación y partida. |
| `js/app.js` | Interfaz: tablero SVG, paneles, diálogos y guardado. |
| `js/pwa.js` | Registro del service worker y aviso de instalación en iOS. |
| `sw.js` | Service worker: guarda la app para usarla sin conexión. |
| `manifest.webmanifest` | Nombre, colores e iconos de la app instalada. |
| `css/styles.css` | Estilos con tema claro y oscuro, y diseños para móvil en vertical y horizontal. |
| `icons/` | Iconos de la app. Se regeneran con `python tools/make_icons.py` (requiere Pillow). |
| `tests/index.html` | Pruebas del motor; ábrelas en el navegador. |
