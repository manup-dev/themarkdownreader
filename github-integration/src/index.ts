import * as core from '@actions/core'

// Re-export the WAL parser for use in github-integration pipeline tasks
export * from './parser'

async function run(): Promise<void> {
  core.info('md-reader github-integration: scaffold ready, pipeline TBD in Task 6')
}

run().catch((err) => {
  core.setFailed(err instanceof Error ? err.message : String(err))
})
