import { describe, it, expect } from 'vitest'
import { buildCollection, resolveRelativePath } from '../lib/collection'

const testFiles = [
  { path: 'README.md', content: '# README\n\n## Installation\n\nInstall here.\n\n## Contributing\n\nContribute here.\n\n- [Guide](guide.md)\n- [Setup](subdir/setup.md)\n- [Setup Step 2](subdir/setup.md#step-2)\n- [Guide Advanced](guide.md#advanced)\n- [Jump to Install](#installation)\n- [Chat System](./chat_system/)\n- [Chat Cheatsheet](./chat_system/INTERVIEW_CHEATSHEET.md)' },
  { path: 'guide.md', content: '# Guide\n\n## Advanced\n\nAdvanced section.\n\n- [Back to README](README.md)\n- [Setup](subdir/setup.md)\n- [README Intro](README.md#introduction)' },
  { path: 'faq.md', content: '# FAQ\n\n- [Install section](README.md#installation)\n- [API](subdir/api.md)' },
  { path: 'subdir/setup.md', content: '# Setup\n\n## Step 1\n\nStep 1.\n\n## Step 2\n\nStep 2.\n\n- [Back to README](../README.md)\n- [Guide](../guide.md)\n- [API](api.md)\n- [README Contributing](../README.md#contributing)' },
  { path: 'subdir/api.md', content: '# API\n\n- [Setup](setup.md)\n- [README](../README.md)\n- [FAQ](../faq.md)' },
  { path: 'other/notes.md', content: '# Notes\n\n- [README](../README.md)\n- [Setup](../subdir/setup.md)\n- [Setup Step 1](../subdir/setup.md#step-1)' },
  { path: 'chat_system/README.md', content: '# Chat System\n\nChat system design.\n\n- [Back to main](../README.md)\n- [Cheatsheet](INTERVIEW_CHEATSHEET.md)' },
  { path: 'chat_system/INTERVIEW_CHEATSHEET.md', content: '# Chat Cheatsheet\n\n- [Back to Chat](README.md)\n- [Back to main](../README.md)' },
]

describe('Collection link resolution', () => {
  const collection = buildCollection(testFiles, 'test')
  const allPaths = collection.files.map((f) => f.path)

  describe('resolveRelativePath', () => {
    it('resolves same-directory sibling from root', () => {
      expect(resolveRelativePath('guide.md', 'README.md', allPaths)).toBe('guide.md')
    })

    it('resolves subdir path from root', () => {
      expect(resolveRelativePath('subdir/setup.md', 'README.md', allPaths)).toBe('subdir/setup.md')
    })

    it('resolves parent dir ../ from subdir', () => {
      expect(resolveRelativePath('../README.md', 'subdir/setup.md', allPaths)).toBe('README.md')
    })

    it('resolves parent dir ../ to sibling dir', () => {
      expect(resolveRelativePath('../guide.md', 'subdir/setup.md', allPaths)).toBe('guide.md')
    })

    it('resolves sibling in same subdir', () => {
      expect(resolveRelativePath('api.md', 'subdir/setup.md', allPaths)).toBe('subdir/api.md')
    })

    it('resolves cross-subdir ../other/', () => {
      expect(resolveRelativePath('../subdir/setup.md', 'other/notes.md', allPaths)).toBe('subdir/setup.md')
    })

    it('returns null for non-existent file', () => {
      expect(resolveRelativePath('nonexistent.md', 'README.md', allPaths)).toBeNull()
    })
  })

  describe('buildCollection link extraction', () => {
    it('README links to guide.md', () => {
      const readme = collection.files.find((f) => f.path === 'README.md')!
      expect(readme.linksTo).toContain('guide.md')
    })

    it('README links to subdir/setup.md', () => {
      const readme = collection.files.find((f) => f.path === 'README.md')!
      expect(readme.linksTo).toContain('subdir/setup.md')
    })

    it('subdir/setup.md links back to README.md via ../', () => {
      const setup = collection.files.find((f) => f.path === 'subdir/setup.md')!
      expect(setup.linksTo).toContain('README.md')
    })

    it('subdir/setup.md links to sibling api.md', () => {
      const setup = collection.files.find((f) => f.path === 'subdir/setup.md')!
      expect(setup.linksTo).toContain('subdir/api.md')
    })

    it('subdir/api.md links to sibling setup.md', () => {
      const api = collection.files.find((f) => f.path === 'subdir/api.md')!
      expect(api.linksTo).toContain('subdir/setup.md')
    })

    it('subdir/api.md links back to README via ../', () => {
      const api = collection.files.find((f) => f.path === 'subdir/api.md')!
      expect(api.linksTo).toContain('README.md')
    })

    it('subdir/api.md links to ../faq.md', () => {
      const api = collection.files.find((f) => f.path === 'subdir/api.md')!
      expect(api.linksTo).toContain('faq.md')
    })

    it('other/notes.md links to ../subdir/setup.md', () => {
      const notes = collection.files.find((f) => f.path === 'other/notes.md')!
      expect(notes.linksTo).toContain('subdir/setup.md')
    })

    it('other/notes.md links back to ../README.md', () => {
      const notes = collection.files.find((f) => f.path === 'other/notes.md')!
      expect(notes.linksTo).toContain('README.md')
    })

    it('guide.md has backlink from README', () => {
      const guide = collection.files.find((f) => f.path === 'guide.md')!
      expect(guide.linkedFrom).toContain('README.md')
    })

    it('README has backlinks from subdir files', () => {
      const readme = collection.files.find((f) => f.path === 'README.md')!
      expect(readme.linkedFrom).toContain('subdir/setup.md')
      expect(readme.linkedFrom).toContain('subdir/api.md')
      expect(readme.linkedFrom).toContain('other/notes.md')
    })
  })

  describe('Directory links (./chat_system/ → chat_system/README.md)', () => {
    it('README links to chat_system/README.md via directory link', () => {
      const readme = collection.files.find((f) => f.path === 'README.md')!
      expect(readme.linksTo).toContain('chat_system/README.md')
    })

    it('README links to chat_system/INTERVIEW_CHEATSHEET.md directly', () => {
      const readme = collection.files.find((f) => f.path === 'README.md')!
      expect(readme.linksTo).toContain('chat_system/INTERVIEW_CHEATSHEET.md')
    })

    it('chat_system/README.md links back to README.md via ../', () => {
      const chat = collection.files.find((f) => f.path === 'chat_system/README.md')!
      expect(chat.linksTo).toContain('README.md')
    })

    it('chat_system/README.md links to sibling INTERVIEW_CHEATSHEET.md', () => {
      const chat = collection.files.find((f) => f.path === 'chat_system/README.md')!
      expect(chat.linksTo).toContain('chat_system/INTERVIEW_CHEATSHEET.md')
    })

    it('chat_system/INTERVIEW_CHEATSHEET.md links to sibling README.md', () => {
      const cheat = collection.files.find((f) => f.path === 'chat_system/INTERVIEW_CHEATSHEET.md')!
      expect(cheat.linksTo).toContain('chat_system/README.md')
    })

    it('chat_system/INTERVIEW_CHEATSHEET.md links back to root README', () => {
      const cheat = collection.files.find((f) => f.path === 'chat_system/INTERVIEW_CHEATSHEET.md')!
      expect(cheat.linksTo).toContain('README.md')
    })
  })

  describe('Real-world: Hands-On-System-Design link patterns', () => {
    const sysFiles = [
      { path: 'README.md', content: '# Hands-on System Design\n\n| System | Cheatsheet |\n|---|---|\n| [Chat System](./chat_system/) | [View](./chat_system/INTERVIEW_CHEATSHEET.md) |\n| [News Feed](./news_feed_system/) | [View](./news_feed_system/INTERVIEW_CHEATSHEET.md) |\n| [Database Fundamentals](./database_fundamentals/) | [View Guide](./database_fundamentals/README.md) |' },
      { path: 'chat_system/README.md', content: '# Chat System\n\nChat design.\n\n- [Cheatsheet](./INTERVIEW_CHEATSHEET.md)' },
      { path: 'chat_system/INTERVIEW_CHEATSHEET.md', content: '# Chat Cheatsheet\n\nKey points.' },
      { path: 'news_feed_system/README.md', content: '# News Feed\n\nFeed design.' },
      { path: 'news_feed_system/INTERVIEW_CHEATSHEET.md', content: '# News Feed Cheatsheet\n\nKey points.' },
      { path: 'database_fundamentals/README.md', content: '# Database Fundamentals\n\n- [Storage](01_STORAGE_INTERNALS.md)\n- [Logic](02_DATABASE_LOGIC.md)\n- [Chat Cheatsheet](../chat_system/INTERVIEW_CHEATSHEET.md)' },
      { path: 'database_fundamentals/01_STORAGE_INTERNALS.md', content: '# Storage Internals\n\nB-trees etc.' },
      { path: 'database_fundamentals/02_DATABASE_LOGIC.md', content: '# Database Logic\n\nQuery processing.' },
    ]
    const sys = buildCollection(sysFiles, 'system-design')

    it('README -> chat_system/ resolves to chat_system/README.md', () => {
      const readme = sys.files.find((f) => f.path === 'README.md')!
      expect(readme.linksTo).toContain('chat_system/README.md')
    })

    it('README -> ./chat_system/INTERVIEW_CHEATSHEET.md resolves', () => {
      const readme = sys.files.find((f) => f.path === 'README.md')!
      expect(readme.linksTo).toContain('chat_system/INTERVIEW_CHEATSHEET.md')
    })

    it('README -> ./news_feed_system/ resolves to news_feed_system/README.md', () => {
      const readme = sys.files.find((f) => f.path === 'README.md')!
      expect(readme.linksTo).toContain('news_feed_system/README.md')
    })

    it('README -> ./database_fundamentals/ resolves to database_fundamentals/README.md', () => {
      const readme = sys.files.find((f) => f.path === 'README.md')!
      expect(readme.linksTo).toContain('database_fundamentals/README.md')
    })

    it('chat_system/README.md -> ./INTERVIEW_CHEATSHEET.md resolves to sibling', () => {
      const chat = sys.files.find((f) => f.path === 'chat_system/README.md')!
      expect(chat.linksTo).toContain('chat_system/INTERVIEW_CHEATSHEET.md')
    })

    it('database_fundamentals/README.md -> 01_STORAGE_INTERNALS.md resolves to sibling', () => {
      const db = sys.files.find((f) => f.path === 'database_fundamentals/README.md')!
      expect(db.linksTo).toContain('database_fundamentals/01_STORAGE_INTERNALS.md')
    })

    it('database_fundamentals/README.md -> ../chat_system/INTERVIEW_CHEATSHEET.md resolves cross-dir', () => {
      const db = sys.files.find((f) => f.path === 'database_fundamentals/README.md')!
      expect(db.linksTo).toContain('chat_system/INTERVIEW_CHEATSHEET.md')
    })

    it('chat_system/README.md has backlink from root README', () => {
      const chat = sys.files.find((f) => f.path === 'chat_system/README.md')!
      expect(chat.linkedFrom).toContain('README.md')
    })
  })
})
