import type { HistoryItem } from '@shared/types'
import { formatBytes, platformLabel, timeAgo } from '../lib/format'
import { FilmIcon, FolderIcon, MusicIcon, PlayIcon, TrashIcon } from './Icons'

interface Props {
  items: HistoryItem[]
  onShow(path: string): void
  onOpen(path: string): void
  onRemove(id: string): void
  onDrag(path: string): void
}

export function Library(p: Props) {
  if (!p.items.length) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-1 py-10 text-center text-muted">
        <p className="font-semibold text-ink">Tu biblioteca está vacía</p>
        <p className="text-[13px]">Aquí aparece todo lo que descargas, listo para arrastrarlo a CapCut.</p>
      </div>
    )
  }

  return (
    <ul className="grid grid-cols-[repeat(auto-fill,minmax(190px,1fr))] gap-3">
      {p.items.map((item) => {
        const usable = item.exists !== false
        return (
          <li
            key={item.id}
            draggable={usable}
            onDragStart={(e) => {
              e.preventDefault()
              if (usable) p.onDrag(item.filePath)
            }}
            onDoubleClick={() => usable && p.onOpen(item.filePath)}
            className={`group overflow-hidden rounded-xl border border-line bg-surface transition-colors ${
              usable ? 'cursor-grab hover:border-accent/50 active:cursor-grabbing' : 'opacity-50'
            }`}
            title={usable ? 'Arrastra a CapCut · doble clic para abrir' : 'El archivo se movió o se borró'}
          >
            <div className="relative aspect-video bg-raised">
              {item.thumbnail ? (
                <img src={item.thumbnail} alt="" className="h-full w-full object-cover" draggable={false} />
              ) : (
                <div className="flex h-full items-center justify-center text-faint">
                  {item.mode === 'video' ? <FilmIcon size={28} /> : <MusicIcon size={28} />}
                </div>
              )}
              <span className="absolute left-2 top-2 flex items-center gap-1 rounded-md bg-black/70 px-1.5 py-0.5 text-[11px] font-semibold">
                {item.mode === 'video' ? <FilmIcon size={12} /> : <MusicIcon size={12} />}
                {item.filePath.split('.').pop()?.toUpperCase()}
              </span>
              <div className="absolute right-1.5 top-1.5 flex gap-1 opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100">
                {usable && (
                  <>
                    <button onClick={() => p.onOpen(item.filePath)} title="Abrir" aria-label="Abrir" className="rounded-md bg-black/70 p-1.5 hover:bg-black">
                      <PlayIcon size={14} />
                    </button>
                    <button onClick={() => p.onShow(item.filePath)} title="Mostrar en la carpeta" aria-label="Mostrar en la carpeta" className="rounded-md bg-black/70 p-1.5 hover:bg-black">
                      <FolderIcon size={14} />
                    </button>
                  </>
                )}
                <button onClick={() => p.onRemove(item.id)} title="Quitar de la biblioteca (no borra el archivo)" aria-label="Quitar de la biblioteca" className="rounded-md bg-black/70 p-1.5 hover:bg-black">
                  <TrashIcon size={14} />
                </button>
              </div>
            </div>
            <div className="p-2.5">
              <p className="line-clamp-2 text-[13px] font-semibold leading-snug" title={item.title}>
                {item.title}
              </p>
              <p className="mt-1 truncate text-[12px] text-faint">
                {[platformLabel(item.platform), usable ? formatBytes(item.size) : 'No encontrado', timeAgo(item.createdAt)]
                  .filter(Boolean)
                  .join(' · ')}
              </p>
            </div>
          </li>
        )
      })}
    </ul>
  )
}
