# Descargador

App de escritorio para Windows, macOS y Linux que descarga video y audio de YouTube, TikTok, Instagram y más de 1,700 sitios, pensada para editores de contenido. Funciona 100 % en local, sin cuentas, sin anuncios y sin telemetría. Los archivos descargados se arrastran directo a CapCut (o a cualquier editor).

## Cómo funciona

- **Electron + React** (electron-vite, Tailwind 4, TypeScript).
- **yt-dlp** hace las descargas; **FFmpeg** une pistas, extrae audio y recodifica.
- yt-dlp necesita un runtime de JavaScript para YouTube: se usa el propio ejecutable de la app en modo Node (`ELECTRON_RUN_AS_NODE`), así que no hace falta Deno.
- **Compatible con editores**: si el video llega en VP9/AV1 (YouTube en 2K/4K), se convierte a H.264. Se usa el encoder de GPU disponible (Windows: NVIDIA, Intel, AMD o Media Foundation/Qualcomm; macOS: VideoToolbox; Linux: NVIDIA o VA-API para Intel/AMD) y, si no hay ninguno, la CPU.
- yt-dlp se copia a la carpeta de datos de la app (`%APPDATA%\Descargador\engine` en Windows, `~/Library/Application Support/Descargador/engine` en macOS, `~/.config/Descargador/engine` en Linux) para poder actualizarlo (`yt-dlp -U`) sin permisos de administrador.

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
| `npm run icons` | Regenera `build/icon.ico`, `build/icon.png` (macOS) y los PNG de `resources/icons` |
| `npm run build:win` | Instalador x64 → `dist/Descargador-Setup-<versión>-x64.exe` |
| `npm run build:win:arm64` | Instalador para Windows en ARM |
| `npm run build:mac` | DMG para Apple Silicon e Intel → `dist/Descargador-<versión>-{arm64,x64}.dmg` (solo en una Mac) |
| `npm run build:mac:arm64` / `build:mac:x64` | DMG de una sola arquitectura |
| `npm run build:linux` | AppImage, .deb y .rpm x64 → `dist/` (solo en Linux; el .rpm necesita `rpmbuild`, paquete `rpm`) |
| `npm run build:linux:arm64` | Los mismos paquetes para Linux ARM64 |

Los binarios quedan en `resources/bin/<win|mac|linux>-<arch>/` (antes `resources/bin/<arch>/`: si ya tenías un entorno de desarrollo, vuelve a ejecutar `npm run fetch-binaries`).

## Distribución

### Windows

El instalador es NSIS por usuario: no pide permisos de administrador y crea accesos en el Menú Inicio y en el escritorio. Sin una PC con Windows, usa el workflow **Build Windows** de GitHub Actions (pestaña *Actions* → *Build Windows* → *Run workflow*, o al publicar un tag `v*`): genera en `windows-latest` un artefacto por arquitectura (`Descargador-Windows-x64` y `Descargador-Windows-arm64`). **No está firmado**, así que Windows SmartScreen mostrará un aviso. Para distribuirlo públicamente conviene firmarlo (Azure Trusted Signing o un certificado OV) configurando `win.signtoolOptions` / `azureSignOptions` en `electron-builder.yml`.

### macOS

- Un DMG por arquitectura (Apple Silicon e Intel), compatible desde **macOS 12**; se arrastra la app a Aplicaciones.
- El DMG solo se puede generar en una Mac. Sin una, usa el workflow **Build macOS** de GitHub Actions (pestaña *Actions* → *Build macOS* → *Run workflow*, o al publicar un tag `v*`): compila en `macos-latest` y deja cada DMG como un artefacto propio (`Descargador-macOS-arm64` para Apple Silicon, `Descargador-macOS-x64` para Intel).
- **No está notarizado** (firma ad-hoc). La primera vez macOS bloqueará la app: ábrela, luego ve a *Ajustes del Sistema → Privacidad y seguridad* y pulsa **Abrir de todos modos**. Para distribuirla sin ese aviso hace falta una cuenta de Apple Developer: quita `mac.identity` y pon `mac.notarize: true` en `electron-builder.yml`, y define `CSC_LINK`, `CSC_KEY_PASSWORD`, `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD` y `APPLE_TEAM_ID` (como secrets en el workflow).
- Las cookies de Chrome/Edge se leen del Llavero: macOS pedirá permiso la primera vez.

### Linux

- Tres formatos por arquitectura (x64 y ARM64):
  - **AppImage** (cualquier distro): `chmod +x Descargador-*.AppImage` y ábrelo. Necesita FUSE 2 (`sudo apt install libfuse2t64` en Ubuntu 24.04, `libfuse2` en versiones anteriores).
  - **.deb** (Debian, Ubuntu, Mint…): `sudo apt install ./Descargador-*.deb`.
  - **.rpm** (Fedora, openSUSE…): `sudo dnf install ./Descargador-*.rpm`.
- El .deb y el .rpm instalan la app en `/opt/Descargador` con su acceso en el menú; el .deb incluye el perfil de AppArmor que Ubuntu 24.04+ pide para el sandbox de Chromium. El AppImage arranca con `--no-sandbox` solo si el sistema no permite user namespaces.
- Sin un equipo con Linux, usa el workflow **Build Linux** de GitHub Actions (pestaña *Actions* → *Build Linux* → *Run workflow*, o al publicar un tag `v*`): compila de forma nativa en `ubuntu-latest` (x64) y `ubuntu-24.04-arm` (ARM64) y deja cada paquete como un artefacto propio (`Descargador-Linux-<arch>-AppImage`, `-deb` y `-rpm`).

FFmpeg se incluye en su compilación GPL; ver `THIRD_PARTY_NOTICES.md`.

## Estructura

```
src/main/        proceso principal: yt-dlp, FFmpeg, cola, historial, IPC
src/preload/     API segura expuesta al renderer (window.api)
src/renderer/    interfaz React
src/shared/      tipos compartidos
scripts/         descarga de binarios e íconos
```
