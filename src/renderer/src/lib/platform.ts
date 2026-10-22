/** La misma interfaz corre en escritorio (Electron) y en Android (Capacitor, ver src/mobile). */
export const isAndroid = window.api.platform === 'android'
