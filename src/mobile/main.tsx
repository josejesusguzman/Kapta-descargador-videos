// Entrada de la app de Android: la misma interfaz que en escritorio, con window.api implementada sobre el plugin nativo.
import { App as CapApp } from '@capacitor/app'
import { createMobileApi } from './api'
import './mobile.css'

window.api = createMobileApi()

// Al volver a la app no hay evento "focus" en el WebView: se simula para que App.tsx revise el portapapeles.
void CapApp.addListener('resume', () => window.dispatchEvent(new Event('focus')))

// App.tsx lee window.api al cargarse, así que se importa después de asignarla.
void import('./root')
