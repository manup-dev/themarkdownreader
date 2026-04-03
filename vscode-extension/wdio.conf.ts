import path from 'node:path'
import url from 'node:url'

const __dirname = path.dirname(url.fileURLToPath(import.meta.url))

export const config: WebdriverIO.Config = {
  runner: 'local',
  tsConfigPath: './tsconfig.e2e.json',

  specs: ['./e2e/specs/**/*.spec.ts'],

  capabilities: [{
    browserName: 'vscode',
    browserVersion: 'stable',
    'wdio:enforceWebDriverClassic': true,
    'wdio:vscodeOptions': {
      extensionPath: path.resolve(__dirname),
      workspacePath: path.resolve(__dirname, 'e2e', 'fixtures'),
      userSettings: {
        'md-reader.theme': 'light',
        'md-reader.fontSize': 18,
      },
    },
  }],

  // Run specs sequentially — multiple VS Code instances on one display conflict
  maxInstances: 1,

  services: ['vscode'],

  framework: 'mocha',
  reporters: ['spec'],

  mochaOpts: {
    ui: 'bdd',
    timeout: 60_000,
  },

  logLevel: 'warn',
}
