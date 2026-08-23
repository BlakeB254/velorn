import {
  Clapperboard, Film, FolderOpen, Image, Sparkles, Workflow, ArrowUpFromLine,
} from 'lucide-react'
import { VISIBLE_TOP_TABS } from './TitleBar'

const TAB_ICONS = {
  editor: Film,
  storyboard: Clapperboard,
  sequence: FolderOpen,
  generate: Sparkles,
  stock: Image,
  comfyui: Workflow,
  export: ArrowUpFromLine,
}

/**
 * Phone shell navigation (docs/ux-guided-mobile-plan.md §5): the TitleBar
 * tab strip moves to a bottom bar — same tabs, icons + labels, ≥44px
 * targets, horizontal scroll when they don't fit.
 */
export default function MobileTabBar({ activeTab, onTabChange }) {
  return (
    <nav
      className="flex-shrink-0 bg-sf-dark-900 border-t border-sf-dark-700 overflow-x-auto"
      data-testid="mobile-tab-bar"
    >
      <div className="flex items-stretch min-w-max w-full">
        {VISIBLE_TOP_TABS.map((tab) => {
          const Icon = TAB_ICONS[tab.id] || Film
          const isActive = activeTab === tab.id
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => onTabChange?.(tab.id)}
              className={`flex-1 flex flex-col items-center justify-center gap-0.5 min-w-[64px] min-h-[52px] px-2 py-1.5 transition-colors ${
                isActive
                  ? 'text-sf-accent'
                  : 'text-sf-text-muted hover:text-sf-text-secondary'
              }`}
            >
              <Icon className="w-[18px] h-[18px]" />
              <span className="text-[9px] font-medium">{tab.label}</span>
            </button>
          )
        })}
      </div>
    </nav>
  )
}
