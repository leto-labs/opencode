# Upstream Sync Guide

This document provides guidance on maintaining sync with the upstream [opencode](https://github.com/sst/opencode) repository.

## When to Sync

Sync with upstream when:

- **New version releases** - Check for new releases on the upstream repository
- **Critical bug fixes** - If upstream fixes a bug that affects our fork
- **Security patches** - Prioritize security-related updates

Avoid syncing:

- During active feature development on our fork
- When you have uncommitted local changes

## How to Sync

### 1. Sync on GitHub UI

1. Go to your fork on GitHub
2. Click "Sync fork" button on the `dev` branch
3. This updates your fork's `dev` branch to match upstream

### 2. Rebase Your Feature Branch

```bash
# Ensure you're on your feature branch
git checkout fork

# Fetch the latest changes
git fetch origin

# Rebase onto the updated dev branch
git rebase origin/dev
```

If conflicts occur, resolve them file by file (see tips below), then:

```bash
git add -A
git rebase --continue
```

## Tips on Rebase

### Use AI Assistance Effectively

When using an AI assistant for conflict resolution, prompt it to:

1. **Analyze before editing** - Ask for suggestions without immediate edits
2. **Check git history** - Request `git log` and `git show` analysis to understand the intent behind each change
3. **Identify the source** - Determine which commits introduced the conflicting changes

Example prompt:
> Help with my current rebase and merge conflict. Suggest how to fix conflicts for each file. Do NOT edit any files. Only suggestions that I will approve one at a time.

### Be Defensive

- **Never blindly accept one side** - Both branches may have important changes
- **Consider combining content** - Conflicts often arise from parallel improvements
- **Check for mobile responsiveness** - Our fork often adds mobile-specific CSS classes (`sm:`, `min-h-[32px] sm:min-h-0`, `flex-col sm:flex-row`)

### Understand Each Change

For each conflict, investigate:

1. **What did HEAD (our branch) add?**
   ```bash
   git log --oneline HEAD~5..HEAD -- <conflicting-file>
   git show <commit-hash> -- <conflicting-file>
   ```

2. **What did incoming (upstream) add?**
   ```bash
   git log --oneline REBASE_HEAD~5..REBASE_HEAD -- <conflicting-file>
   ```

3. **Is the conflict about the same feature or different features?**
   - Same feature: Choose the better implementation
   - Different features: Merge both changes

### Common Conflict Patterns

| Pattern | Resolution Strategy |
|---------|---------------------|
| Mobile responsiveness classes | Keep our mobile classes, integrate upstream features |
| New upstream features | Accept incoming, ensure mobile compatibility |
| Platform-specific code (Tauri) | Carefully merge, verify `#[cfg(mobile)]` blocks |
| Lock files (`bun.lock`) | Accept either side, regenerate with `bun install` |
| Deep linking / authentication | Ensure both features are preserved |

### Watch for Dependencies

Some changes require other changes to work:

- If upstream adds a function call, ensure the function definition exists
- If we add a plugin (`deep_link`), ensure the import and initialization are both present
- If code uses `#[cfg(not(mobile))]`, ensure desktop-only features aren't broken

## Post-Rebase Tests

After completing a rebase, run through this verification checklist:

### 1. Unit Tests

```bash
bun test
```

### 2. Development Server

```bash
# Start the backend server
bun run dev

# Verify the server starts without errors
# Check logs for any warnings
```

### 3. Web App

```bash
# In packages/app
bun run dev

# Test on desktop browser
# Test on mobile browser (responsive mode)
```

### 4. Desktop App

```bash
# In packages/desktop
bun run dev

# Verify window opens
# Check for console errors
```

### 5. Mobile Native App

```bash
# Android
cd packages/desktop
bun run android

# iOS (macOS only)
bun run ios
```

### 6. Feature Testing Checklist

| Feature | Test Steps |
|---------|------------|
| **Regular Messages** | Send a message, verify response |
| **Streaming** | Confirm responses stream correctly |
| **Model Selection** | Switch between models |
| **Settings** | Open settings, verify all sections render |
| **Native Realtime Voice** | Start voice session, speak, verify transcription |
| **Deep Linking** | Test `opencode://` URLs (desktop) |
| **Authentication** | Verify auth headers are sent with requests |
| **Mobile Layout** | Test responsive layouts on mobile viewport |

### 7. Build Verification

```bash
# Desktop build
cd packages/desktop
bun run build

# Android build
bun run android:build

# iOS build (macOS only)
bun run ios:build
```

## Troubleshooting

### Conflict markers still present

If `git status` shows `UU` files after you think you've resolved:

```bash
# Check for remaining conflict markers
grep -rn "<<<<<<" packages/
grep -rn "=======" packages/
grep -rn ">>>>>>" packages/
```

### Rebase stuck / want to start over

```bash
git rebase --abort
```

### Lock file issues

```bash
# Remove and regenerate
rm bun.lock
bun install
```

### TypeScript errors after rebase

```bash
# Check for type errors
bun run typecheck

# May need to restart TypeScript server in IDE
```
