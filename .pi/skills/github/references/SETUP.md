# GitHub CLI Setup Guide

Step-by-step guide to set up gh CLI authentication in the sandbox environment.

## Quick Setup (OAuth - Recommended)

The easiest method is OAuth via browser:

```bash
gh auth login --web --hostname github.com
```

This will:
1. Display a one-time code (e.g., `XXXX-XXXX`)
2. Open `https://github.com/login/device` in your browser
3. Enter the code to authenticate
4. Complete the OAuth flow

## Step-by-Step (If OAuth Doesn't Work)

### Step 1: Create Personal Access Token

Ask the user to create a token:

> Please create a GitHub Personal Access Token:
> 
> 1. Open: https://github.com/settings/tokens?type=beta (Fine-grained tokens)
>    - Or for classic tokens: https://github.com/settings/tokens/new
> 
> 2. **For Fine-grained token (recommended):**
>    - **Token name:** `bosun-gh-cli`
>    - **Expiration:** your preference
>    - **Repository access:** All repositories (or select specific ones)
>    - **Permissions:** 
>      - `Contents` → Read and write
>      - `Issues` → Read and write  
>      - `Pull requests` → Read and write
>      - `Metadata` → Read-only (auto-selected)
> 
> 3. **For Classic token:**
>    - **Note:** `bosun-gh-cli`
>    - **Scopes:** `repo`, `read:org`, `workflow`
> 
> 4. Click **"Generate token"**
> 5. **Copy the token** (it's only shown once!)

Wait for user to provide the token.

### Step 2: Authenticate with Token

Once user provides the token:

```bash
echo "<token>" | gh auth login --with-token
```

Or interactively:
```bash
gh auth login
# Select: GitHub.com
# Select: HTTPS
# Select: Paste an authentication token
# Paste the token
```

## Step 3: Verify

Confirm authentication works:

```bash
gh auth status
```

Should show:
```
github.com
  ✓ Logged in to github.com account <username>
  - Active account: true
  - Git operations protocol: https
  - Token: gho_************************************
  - Token scopes: 'gist', 'read:org', 'repo'
```

## Config Persistence

The token persists in `..bosun-home/.config/gh/hosts.yml` - this survives sandbox restarts.

```bash
# Verify config location
ls -la ..bosun-home/.config/gh/
```

## Troubleshooting

### "gh auth login" hangs
Use `--web` flag for browser-based OAuth:
```bash
gh auth login --web
```

### Token permission errors
Ensure token has required scopes:
- `repo` - Full repository access
- `read:org` - Read org membership (for private repos)

### Multiple accounts
List and switch between accounts:
```bash
gh auth status
gh auth switch
```

## Success

Tell the user:

> gh CLI is now configured! You can use it to interact with GitHub.
> 
> Example commands:
> - `gh pr list --repo owner/repo`
> - `gh issue view 123 --repo owner/repo`
> - `gh api repos/owner/repo`
