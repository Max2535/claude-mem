# Claude-Mem: AI Development Instructions

Claude-mem is a Claude Code plugin providing persistent memory across sessions. It captures tool usage, compresses observations using the Claude Agent SDK, and injects relevant context into future sessions.

## Build

```bash
npm run build-and-sync        # Build, sync to marketplace, restart worker
```

## File Locations

This fork is installed as `claude-mem-pro-max@max2535`. Claude Code derives the
three directories below from those two names, so never hardcode them — they live
in `src/shared/plugin-identity.ts`, and `src/shared/paths.ts` exports the roots.

- **Source**: `<project-root>/src/`
- **Built Plugin**: `<project-root>/plugin/`
- **Marketplace**: `~/.claude/plugins/marketplaces/max2535/` (`MARKETPLACE_ROOT`)
- **Installed Plugin**: `~/.claude/plugins/cache/max2535/claude-mem-pro-max/<version>/` (`PLUGIN_CACHE_ROOT`) — this is what the hooks actually resolve against
- **Plugin Data**: `~/.claude/plugins/data/claude-mem-pro-max-max2535/`
- **Database**: `~/.claude-mem/claude-mem.db`
- **Chroma**: `~/.claude-mem/chroma/`

## Requirements

- **Bun** (all platforms - auto-installed if missing)
- **uv** (all platforms - auto-installed if missing, provides Python for Chroma)
- Node.js

## Documentation

**Public Docs**: https://docs.claude-mem.ai (Mintlify)
**Source**: `docs/public/` - MDX files, edit `docs.json` for navigation
**Deploy**: Auto-deploys from GitHub on push to main

## Important

No need to edit the changelog ever, it's generated automatically.
