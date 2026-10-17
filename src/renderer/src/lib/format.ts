export function formatDuration(seconds?: number): string {
  if (seconds === undefined || !Number.isFinite(seconds)) return ''
  const s = Math.round(seconds)
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = String(s % 60).padStart(2, '0')
  return h ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`
}

export function formatBytes(bytes?: number): string {
  if (!bytes) return ''
  const units = ['B', 'KB', 'MB', 'GB']
  let v = bytes
  let i = 0
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024
    i++
  }
  return `${v >= 100 || i === 0 ? Math.round(v) : v.toFixed(1)} ${units[i]}`
}

export const formatSpeed = (bps?: number): string => (bps ? `${formatBytes(bps)}/s` : '')

export function formatEta(seconds?: number): string {
  if (seconds === undefined || seconds < 0) return ''
  if (seconds < 60) return `${Math.round(seconds)} s`
  return formatDuration(seconds)
}

export function qualityLabel(q: number): string {
  if (q >= 2160) return '4K'
  if (q === 1440) return '2K'
  return `${q}p`
}

export function qualityHint(q: number): string {
  if (q >= 2160) return '2160p'
  if (q === 1440) return '1440p'
  if (q === 1080) return 'Full HD'
  if (q === 720) return 'HD'
  return ''
}

const PLATFORMS: Record<string, string> = {
  youtube: 'YouTube',
  youtubetab: 'YouTube',
  tiktok: 'TikTok',
  instagram: 'Instagram',
  twitter: 'X',
  facebook: 'Facebook',
  vimeo: 'Vimeo',
  twitch: 'Twitch',
  twitchclips: 'Twitch',
  reddit: 'Reddit',
  soundcloud: 'SoundCloud',
  pinterest: 'Pinterest',
  dailymotion: 'Dailymotion',
  generic: 'Web'
}

export function platformLabel(key: string): string {
  return PLATFORMS[key.toLowerCase()] ?? key
}

export function timeAgo(ts: number): string {
  const diff = (Date.now() - ts) / 1000
  if (diff < 60) return 'hace un momento'
  if (diff < 3600) return `hace ${Math.floor(diff / 60)} min`
  if (diff < 86400) return `hace ${Math.floor(diff / 3600)} h`
  const days = Math.floor(diff / 86400)
  if (days < 7) return days === 1 ? 'ayer' : `hace ${days} días`
  return new Date(ts).toLocaleDateString('es', { day: 'numeric', month: 'short', year: 'numeric' })
}
