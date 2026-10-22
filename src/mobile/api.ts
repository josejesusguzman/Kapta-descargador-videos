// window.api en Android: implementa la misma API que el preload de escritorio sobre el plugin nativo "Kapta"
// (android/app/src/main/java/com/kapta/descargador/KaptaPlugin.kt). Las descargas viven en un servicio nativo,
// así que siguen aunque se cierre la app.
import { registerPlugin, type PluginListenerHandle } from '@capacitor/core'
import type {
  AppCommand,
  DownloadRequest,
  EngineInfo,
  EngineUpdateResult,
  HistoryItem,
  Job,
  KaptaDescargadorApi,
  LoginRequiredError,
  MediaInfo,
  Settings
} from '@shared/types'

interface KaptaPlugin {
  analyze(o: { url: string }): Promise<MediaInfo>
  addJob(o: { request: DownloadRequest }): Promise<Job>
  cancelJob(o: { id: string }): Promise<void>
  retryJob(o: { id: string }): Promise<void>
  dismissJob(o: { id: string }): Promise<void>
  listJobs(): Promise<{ jobs: Job[] }>
  listHistory(): Promise<{ items: HistoryItem[] }>
  removeHistory(o: { id: string }): Promise<void>
  getSettings(): Promise<Settings>
  setSettings(o: { patch: Partial<Settings> }): Promise<Settings>
  openFile(o: { path: string }): Promise<void>
  readClipboardUrl(): Promise<{ url?: string }>
  engineInfo(): Promise<EngineInfo>
  updateEngine(): Promise<EngineUpdateResult>
  appVersion(): Promise<{ version: string }>
  login(o: { site: string }): Promise<{ ok: boolean }>
  logout(o: { site: string }): Promise<void>
  listLogins(): Promise<{ sites: string[] }>
  /** Entrega las órdenes que llegaron antes de que la interfaz se suscribiera (links compartidos al abrir la app). */
  takePendingCommands(): Promise<{ commands: AppCommand[] }>
  addListener(event: 'jobUpdate', cb: (job: Job) => void): Promise<PluginListenerHandle>
  addListener(event: 'jobRemoved', cb: (e: { id: string }) => void): Promise<PluginListenerHandle>
  addListener(event: 'historyChanged', cb: () => void): Promise<PluginListenerHandle>
  addListener(event: 'command', cb: (command: AppCommand) => void): Promise<PluginListenerHandle>
}

const Kapta = registerPlugin<KaptaPlugin>('Kapta')

/** Los rechazos del plugin traen `code` y `data`; se convierten en Error con mensaje limpio (y `loginSite`). */
async function call<T>(promise: Promise<T>): Promise<T> {
  try {
    return await promise
  } catch (err) {
    const e = err as { message?: string; code?: string; data?: { loginSite?: string } }
    const out: LoginRequiredError = new Error(e.message || 'Error inesperado')
    if (e.code === 'LOGIN_REQUIRED' && e.data?.loginSite) out.loginSite = e.data.loginSite
    throw out
  }
}

/** Suscripción síncrona como la del preload: devuelve la función para quitarla aunque el registro sea asíncrono. */
function subscribe(register: () => Promise<PluginListenerHandle>): () => void {
  const handle = register()
  return () => void handle.then((h) => h.remove())
}

export function createMobileApi(): KaptaDescargadorApi {
  return {
    platform: 'android',
    analyze: (url) => call(Kapta.analyze({ url })),
    addJob: (request) => call(Kapta.addJob({ request })),
    cancelJob: (id) => call(Kapta.cancelJob({ id })),
    retryJob: (id) => call(Kapta.retryJob({ id })),
    dismissJob: (id) => call(Kapta.dismissJob({ id })),
    listJobs: async () => (await call(Kapta.listJobs())).jobs,
    onJobUpdate: (cb) => subscribe(() => Kapta.addListener('jobUpdate', cb)),
    onJobRemoved: (cb) => subscribe(() => Kapta.addListener('jobRemoved', (e) => cb(e.id))),

    listHistory: async () => (await call(Kapta.listHistory())).items,
    removeHistory: (id) => call(Kapta.removeHistory({ id })),
    onHistoryChange: (cb) => subscribe(() => Kapta.addListener('historyChanged', cb)),

    getSettings: () => call(Kapta.getSettings()),
    setSettings: (patch) => call(Kapta.setSettings({ patch })),

    openFile: (path) => call(Kapta.openFile({ path })),

    readClipboardUrl: async () => (await Kapta.readClipboardUrl().catch(() => ({ url: undefined }))).url ?? null,
    onCommand: (cb) => {
      const off = subscribe(() => Kapta.addListener('command', cb))
      void Kapta.takePendingCommands().then(({ commands }) => commands.forEach(cb))
      return off
    },
    getOpenAtLogin: async () => false,
    setOpenAtLogin: async () => false,
    engineInfo: () => call(Kapta.engineInfo()),
    updateEngine: () => call(Kapta.updateEngine()),
    appVersion: async () => (await call(Kapta.appVersion())).version,

    login: async (site) => (await call(Kapta.login({ site }))).ok,
    logout: (site) => call(Kapta.logout({ site })),
    listLogins: async () => (await call(Kapta.listLogins())).sites
  }
}
