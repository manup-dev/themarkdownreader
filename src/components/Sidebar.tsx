import { useStore } from '../store/useStore'
import { OutlinePanel } from './OutlinePanel'
import { FileExplorer } from './FileExplorer'

/**
 * Layout shell for the context-navigator sidebar. Picks between
 * <OutlinePanel> (single-file TOC) and <FileExplorer> (folder tree)
 * based on whether a folder session is loaded.
 *
 * Returns null in focus mode (sidebarCollapsed=true) when the user
 * has something to focus on (active file OR markdown loaded). Edge
 * case: if a folder is loaded but there's no active file, we override
 * the collapse and force-show the sidebar — there's nothing to focus
 * on so hiding the nav would strand the user.
 *
 * Created 2026-04-15 for the unified directory/file view refactor.
 */
export function Sidebar() {
  const folderFiles = useStore(s => s.folderFiles)
  const activeFilePath = useStore(s => s.activeFilePath)
  const sidebarCollapsed = useStore(s => s.sidebarCollapsed)
  const markdown = useStore(s => s.markdown)

  const folderMode = folderFiles !== null
  const hasActiveFile = !!markdown || !!activeFilePath

  // Focus mode: hide sidebar only if there's a file being actively read.
  // If the user is in folder mode but hasn't selected a file yet, we
  // keep the sidebar visible so they have something to click.
  if (sidebarCollapsed && hasActiveFile) {
    return null
  }

  return (
    <aside
      id="sidebar"
      className="w-[280px] shrink-0 border-r border-gray-200 dark:border-gray-700 bg-gray-50/50 dark:bg-gray-900/30 flex flex-col h-full"
    >
      {folderMode ? <FileExplorer /> : <OutlinePanel />}
    </aside>
  )
}
