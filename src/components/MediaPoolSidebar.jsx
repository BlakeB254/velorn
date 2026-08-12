import { FolderOpen } from 'lucide-react'
import AssetsPanel from './panels/AssetsPanel'

export default function MediaPoolSidebar({ open, onToggle, isActive = true }) {
  return (
    <div
      className="h-full flex-shrink-0 flex border-r border-sf-dark-700 bg-sf-dark-950"
      style={{ width: open ? 380 : 44 }}
    >
      <div className="w-11 flex-shrink-0 flex flex-col items-center pt-2 border-r border-sf-dark-800">
        <button
          type="button"
          onClick={onToggle}
          className={`w-9 h-9 rounded-md flex items-center justify-center ${
            open ? 'bg-sf-dark-800 text-sf-accent' : 'text-sf-text-muted hover:text-sf-text-primary hover:bg-sf-dark-800/70'
          }`}
          title={open ? 'Hide media pool' : 'Show media pool'}
        >
          <FolderOpen className="w-4 h-4" />
        </button>
        <span
          className="mt-3 text-[9px] uppercase tracking-wide text-sf-text-muted"
          style={{ writingMode: 'vertical-rl', transform: 'rotate(180deg)' }}
        >
          Media pool
        </span>
      </div>
      {open && (
        <div className="flex-1 min-w-0 min-h-0">
          <AssetsPanel isActive={isActive} />
        </div>
      )}
    </div>
  )
}
