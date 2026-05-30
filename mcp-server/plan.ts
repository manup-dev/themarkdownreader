export interface PlanTask {
  text: string
  status: 'open' | 'done'
  section: string
}

const HEADING_RE = /^#{1,6}\s+(.+?)\s*$/
const TASK_RE = /^\s*[-*]\s+\[([ xX])\]\s+(.+?)\s*$/

// Dependency-free GFM task-list extraction. A heading sets the current section;
// a `- [ ]` / `* [x]` line becomes a task. Mirrors the browser-side
// src/lib/plan-tasks.ts semantics without pulling in the remark toolchain.
export function extractTasks(markdown: string): PlanTask[] {
  const tasks: PlanTask[] = []
  let section = ''
  for (const line of markdown.split('\n')) {
    const heading = HEADING_RE.exec(line)
    if (heading) {
      section = heading[1].trim()
      continue
    }
    const task = TASK_RE.exec(line)
    if (task) {
      tasks.push({
        text: task[2].trim(),
        status: task[1] === ' ' ? 'open' : 'done',
        section,
      })
    }
  }
  return tasks
}

export function buildTaskPrompt(task: PlanTask, fileName: string): string {
  const where = task.section
    ? `In \`${fileName}\` under section "${task.section}", implement this task:`
    : `In \`${fileName}\`, implement this task:`
  return `${where}\n\n  ${task.text}\n\nPlease implement it and report what you changed.`
}
