# Kapta Descargador

App de escritorio para Windows, macOS y Linux que descarga video y audio de YouTube, TikTok, Instagram y más de 1,700 sitios, pensada para editores de contenido. Funciona 100 % en local, sin cuentas, sin anuncios y sin telemetría. Los archivos descargados se arrastran directo a CapCut (o a cualquier editor).

## Cómo funciona

- **Electron + React** (electron-vite, Tailwind 4, TypeScript).
- **yt-dlp** hace las descargas; **FFmpeg** une pistas, extrae audio y recodifica.
- yt-dlp necesita un runtime de JavaScript para YouTube: se usa el propio ejecutable de la app en modo Node (`ELECTRON_RUN_AS_NODE`), así que no hace falta Deno.
- **Compatible con editores**: si el video llega en VP9/AV1 (YouTube en 2K/4K), se convierte a H.264. Se usa el encoder de GPU disponible (Windows: NVIDIA, Intel, AMD o Media Foundation/Qualcomm; macOS: VideoToolbox; Linux: NVIDIA o VA-API para Intel/AMD) y, si no hay ninguno, la CPU.
- yt-dlp se copia a la carpeta de datos de la app (`%APPDATA%\Kapta Descargador\engine` en Windows, `~/Library/Application Support/Kapta Descargador/engine` en macOS, `~/.config/Kapta Descargador/engine` en Linux) para poder actualizarlo (`yt-dlp -U`) sin permisos de administrador.

### Cambio de nombre (antes "Descargador")

Desde la versión 0.3 la app se llama **Kapta Descargador** y su identificador es `com.kapta.descargador` (antes `com.descargador.app`):

- Al abrirla por primera vez copia los ajustes y el historial de la carpeta de datos anterior (`Descargador`) a la nueva (`Kapta Descargador`). La carpeta anterior no se toca.
- En Windows se instala como una app nueva: desinstala "Descargador" desde *Configuración → Aplicaciones*.
- En macOS borra `Descargador.app` de Aplicaciones y vuelve a permitir las notificaciones y *Abrir al iniciar sesión*.
- En Linux, el .deb y el .rpm instalan un paquete nuevo (`kapta-descargador`): desinstala el anterior con `sudo apt remove descargador` o `sudo dnf remove descargador`.

## Desarrollo

```bash
npm install
npm run fetch-binaries   # yt-dlp + FFmpeg para el sistema y la arquitectura de este equipo, con verificación SHA-256
npm run dev
```

Otros comandos:

| Comando | Qué hace |
|---|---|
| `npm test` | Pruebas unitarias (parser de progreso, argumentos de yt-dlp, errores) |
| `npm run typecheck` | TypeScript en main/preload y renderer |
| `npm run icons` | Regenera `build/icon.ico`, `build/icon.png` (macOS) y los PNG de `resources/icons` (incluido el ícono de la barra de menú de macOS) |
| `npm run build:win` | Instalador x64 → `dist/Windows-Kapta-Descargador-Setup-<versión>-x64.exe` |
| `npm run build:win:arm64` | Instalador para Windows en ARM |
| `npm run build:mac` | DMG para Apple Silicon e Intel → `dist/macOS-Kapta-Descargador-<versión>-{arm64,x64}.dmg` (solo en una Mac) |
| `npm run build:mac:arm64` / `build:mac:x64` | DMG de una sola arquitectura |
| `npm run build:linux` | AppImage, .deb y .rpm x64 → `dist/` (solo en Linux; el .rpm necesita `rpmbuild`, paquete `rpm`) |
| `npm run build:linux:arm64` | Los mismos paquetes para Linux ARM64 |

Los binarios quedan en `resources/bin/<win|mac|linux>-<arch>/` (antes `resources/bin/<arch>/`: si ya tenías un entorno de desarrollo, vuelve a ejecutar `npm run fetch-binaries`).

## Distribución

### Releases automáticos en cada PR a `main`

El workflow **PR a main** (`.github/workflows/pr-release.yml`) corre al abrir un pull request hacia `main` y en cada push posterior a ese PR:

1. Toma el siguiente número de tag respecto al más alto que exista (`0.1` → `0.2` → … → `0.9` → `0.10`) y lo reserva para el PR. Cada PR tiene un solo número.
2. Ejecuta los tres builds (**Build macOS**, **Build Windows** y **Build Linux**) sobre el último commit del PR, con ese número como versión de la app (`0.2` → `0.2.0`).
3. Publica el release con ese tag y le adjunta los 10 instaladores sueltos, sin zip: DMG de macOS (Apple Silicon e Intel), instaladores de Windows (x64 y ARM64) y AppImage, .deb y .rpm de Linux (x64 y ARM64).

   Cada instalador empieza con el sistema al que va dirigido y termina con la arquitectura, por ejemplo `macOS-Kapta-Descargador-0.3.0-arm64.dmg`, `Windows-Kapta-Descargador-Setup-0.3.0-x64.exe` o `Linux-Kapta-Descargador-0.3.0-x86_64.AppImage`.

Un push nuevo al mismo PR vuelve a compilar, reemplaza los instaladores de ese release y mueve el tag al último commit. Si algún build falla, el número queda reservado (como borrador) y se publica cuando el PR vuelva a compilar bien. Los PR desde forks solo compilan: no reciben tag ni release. "Latest" queda siempre en el número más alto, aunque se actualice un PR anterior, y volver a ejecutar una corrida vieja no regresa el release a un commit anterior.

Si GitHub rechaza crear o mover el tag con el token del workflow (puede pasar en PRs que modifican `.github/workflows`), crea un token fine-grained solo para este repo con *Contents* y *Workflows* en *Read and write* y guárdalo como secret `RELEASE_TOKEN`. Mantén desactivado *Immutable releases* (Settings → General → Releases): con él activo, un release publicado ya no acepta instaladores nuevos.

Los tres workflows de build también se pueden lanzar a mano (pestaña *Actions* → *Run workflow*); así dejan los instaladores como artefactos de la ejecución, sin release.

### Windows

El instalador es NSIS por usuario: no pide permisos de administrador y crea accesos en el Menú Inicio y en el escritorio. Sin una PC con Windows, usa el workflow **Build Windows** de GitHub Actions (pestaña *Actions* → *Build Windows* → *Run workflow*): genera en `windows-latest` un artefacto por arquitectura (`Kapta-Descargador-Windows-x64` y `Kapta-Descargador-Windows-arm64`). **No está firmado**, así que Windows SmartScreen mostrará un aviso. Para distribuirlo públicamente conviene firmarlo (Azure Trusted Signing o un certificado OV) configurando `win.signtoolOptions` / `azureSignOptions` en `electron-builder.yml`.

### macOS

- Un DMG por arquitectura (Apple Silicon e Intel), compatible desde **macOS 13** (Ventura, el mínimo de Electron 44); se arrastra la app a Aplicaciones.
- **Barra de menú** (solo macOS): un ícono arriba a la derecha muestra el progreso de las descargas. Su menú permite:
  - Descargar el link copiado como video o solo audio, con la calidad y el formato predeterminados, sin abrir la ventana; o abrirlo en la ventana para elegir calidad.
  - Ver las descargas en curso, cancelarlas o reintentar las que fallaron.
  - Abrir las últimas descargas, mostrarlas en el Finder o compartirlas (AirDrop, Mensajes…).
  - Abrir la carpeta de descargas, los ajustes y activar *Abrir al iniciar sesión* (arranca solo en la barra de menú; la app tiene que estar en Aplicaciones).

  Al cerrar la ventana, la app sigue en la barra de menú (sin ícono en el Dock) y las descargas continúan; ⌘Q o *Salir de Kapta Descargador* la cierran. Se desactiva en *Ajustes → Barra de menú*, y entonces cerrar la ventana vuelve a cerrar la app.
- El DMG solo se puede generar en una Mac. Sin una, usa el workflow **Build macOS** de GitHub Actions (pestaña *Actions* → *Build macOS* → *Run workflow*): compila en `macos-latest` y deja cada DMG como un artefacto propio (`Kapta-Descargador-macOS-arm64` para Apple Silicon, `Kapta-Descargador-macOS-x64` para Intel).
- **No está notarizado** (firma ad-hoc). La primera vez macOS bloqueará la app: ábrela, luego ve a *Ajustes del Sistema → Privacidad y seguridad* y pulsa **Abrir de todos modos**. Para distribuirla sin ese aviso hace falta una cuenta de Apple Developer: quita `mac.identity` y pon `mac.notarize: true` en `electron-builder.yml`, y define `CSC_LINK`, `CSC_KEY_PASSWORD`, `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD` y `APPLE_TEAM_ID` (como secrets en el workflow).
- Las cookies de Chrome/Edge se leen del Llavero: macOS pedirá permiso la primera vez.

### Linux

- Tres formatos por arquitectura (x64 y ARM64):
  - **AppImage** (cualquier distro): `chmod +x Linux-Kapta-Descargador-*.AppImage` y ábrelo. Necesita FUSE 2 (`sudo apt install libfuse2t64` en Ubuntu 24.04, `libfuse2` en versiones anteriores).
  - **.deb** (Debian, Ubuntu, Mint…): `sudo apt install ./Linux-Kapta-Descargador-*.deb`.
  - **.rpm** (Fedora, openSUSE…): `sudo dnf install ./Linux-Kapta-Descargador-*.rpm`.
- El .deb y el .rpm instalan la app en `/opt/Kapta Descargador` con su acceso en el menú; el .deb incluye el perfil de AppArmor que Ubuntu 24.04+ pide para el sandbox de Chromium. El AppImage arranca con `--no-sandbox` solo si el sistema no permite user namespaces.
- Sin un equipo con Linux, usa el workflow **Build Linux** de GitHub Actions (pestaña *Actions* → *Build Linux* → *Run workflow*): compila de forma nativa en `ubuntu-latest` (x64) y `ubuntu-24.04-arm` (ARM64) y deja cada paquete como un artefacto propio (`Kapta-Descargador-Linux-<arch>-AppImage`, `-deb` y `-rpm`).

FFmpeg se incluye en su compilación GPL; ver `THIRD_PARTY_NOTICES.md`.

## Estructura

```
src/main/        proceso principal: yt-dlp, FFmpeg, cola, historial, IPC
src/preload/     API segura expuesta al renderer (window.api)
src/renderer/    interfaz React
src/shared/      tipos compartidos
scripts/         descarga de binarios e íconos
```
