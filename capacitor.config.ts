import type { CapacitorConfig } from '@capacitor/cli'

// App de Android: la interfaz sale de `npm run build:mobile` (out/mobile); lo nativo está en android/.
const config: CapacitorConfig = {
  appId: 'com.kapta.descargador',
  appName: 'Kapta Descargador',
  webDir: 'out/mobile',
  android: {
    backgroundColor: '#0d0e12'
  }
}

export default config
