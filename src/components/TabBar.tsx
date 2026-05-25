import { useState } from 'react'
import { useStore } from '../store/useStore'
import { Folder, FileText, X, Plus } from 'lucide-react'
import { RecentsList } from './RecentsList'

export function TabBar() {
  const tabs = useStore((s) => s.tabs)
  const activeTabId = useStore((s) => s.activeTabId)
  const switchTab = useStore((s) => s.switchTab)
  const closeTab = useStore((s) => s.closeTab)

  if (tabs.length === 0) return null

  return (
    <div className="flex items-stretch border-b border-gray-200 dark:border-gray-800 sepia:border-sepia-200 bg-gray-50 dark:bg-gray-900 sepia:bg-sepia-100/40">
      <div
        role="tablist"
        aria-label="Open workspaces"
        className="flex items-stretch overflow-x-auto flex-1 min-w-0"
      >
        {tabs.map((tab) => {
          const isActive = tab.id === activeTabId
          const Icon = tab.kind === 'folder' ? Folder : FileText
          return (
            <div
              key={tab.id}
              role="tab"
              aria-selected={isActive}
              aria-label={tab.title}
              onClick={() => switchTab(tab.id)}
              className={[
                'group flex items-center gap-2 px-3 py-1.5 text-sm cursor-pointer border-r border-gray-200 dark:border-gray-800 sepia:border-sepia-200 min-w-0 max-w-[200px]',
                isActive
                  ? 'bg-white dark:bg-gray-950 sepia:bg-sepia-50 text-gray-900 dark:text-gray-100 sepia:text-sepia-900'
                  : 'text-gray-600 dark:text-gray-400 sepia:text-sepia-700 hover:bg-gray-100 dark:hover:bg-gray-800 sepia:hover:bg-sepia-100',
              ].join(' ')}
            >
              {tab.kind !== 'empty' && <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden />}
              <span className="truncate" title={tab.title}>{tab.title}</span>
              <button
                type="button"
                aria-label={`Close ${tab.title}`}
                onClick={(e) => { e.stopPropagation(); closeTab(tab.id) }}
                className="opacity-0 group-hover:opacity-100 focus:opacity-100 rounded p-0.5 hover:bg-gray-200 dark:hover:bg-gray-700"
              >
                <X className="h-3 w-3" aria-hidden />
              </button>
            </div>
          )
        })}
      </div>
      <div className="flex items-center px-1 shrink-0">
        <NewTabMenu />
      </div>
    </div>
  )
}

function NewTabMenu() {
  const [open, setOpen] = useState(false)
  const newEmptyTab = useStore((s) => s.newEmptyTab)
  return (
    <div className="relative">
      <button
        type="button"
        aria-label="Open recent files"
        title="New tab"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1 px-2 py-1 text-sm text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700 rounded"
      >
        <Plus className="h-3.5 w-3.5" />
      </button>
      {open && (
        <div
          className="absolute right-0 top-full mt-1 z-20 min-w-[240px] max-w-[360px] bg-white dark:bg-gray-900 sepia:bg-sepia-50 border border-gray-200 dark:border-gray-700 sepia:border-sepia-200 rounded-lg shadow-lg overflow-hidden"
          onMouseLeave={() => setOpen(false)}
        >
          <button
            type="button"
            onClick={() => { newEmptyTab(); setOpen(false) }}
            className="w-full text-left px-3 py-2 text-sm hover:bg-gray-100 dark:hover:bg-gray-800"
          >
            New empty tab
          </button>
          <div className="border-t border-gray-100 dark:border-gray-800" />
          <div className="px-3 py-1 text-[11px] font-medium uppercase tracking-wider text-gray-500">Recent</div>
          <RecentsList onOpened={() => setOpen(false)} limit={8} />
        </div>
      )}
    </div>
  )
}
