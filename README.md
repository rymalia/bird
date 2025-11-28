# bird

A command-line tool for posting tweets and replies via Twitter/X's GraphQL API.

## Installation

```bash
cd ~/Projects/bird
pnpm install
pnpm run binary  # Creates the 'bird' executable
```

## Usage

### Post a tweet

```bash
bird tweet "Hello from bird!"
```

### Reply to a tweet

```bash
# Using tweet URL
bird reply "https://x.com/user/status/1234567890" "This is my reply"

# Using tweet ID directly
bird reply 1234567890 "This is my reply"
```

### Read a tweet

```bash
# Get tweet content by URL or ID
bird read "https://x.com/user/status/1234567890"
bird read 1234567890 --json
```

### Check credentials

```bash
bird check
```

## Authentication

The tool resolves credentials in the following order of priority:

1. **CLI arguments** (highest priority)
   ```bash
   bird --auth-token "xxx" --ct0 "yyy" tweet "Hello"
   ```

2. **Environment variables**
   ```bash
   export AUTH_TOKEN="xxx"
   export CT0="yyy"
   bird tweet "Hello"
   ```

   Alternative env var names: `TWITTER_AUTH_TOKEN`, `TWITTER_CT0`

3. **Chrome cookies** (fallback - macOS only)
   - Automatically extracts from Chrome's cookie database
   - Requires Chrome to be logged into x.com
   - May prompt for keychain access on first run

### Getting Your Cookies

1. Open Chrome and log into x.com
2. Open DevTools (Cmd+Option+I)
3. Go to Application > Cookies > x.com
4. Copy the values for `auth_token` and `ct0`

## Development

```bash
# Run in development mode
pnpm run dev tweet "Test"

# Run tests
pnpm test

# Run linter
pnpm run lint

# Fix lint issues
pnpm run lint:fix
```

## Notes

- Chrome cookie extraction requires macOS (uses `sqlite3` and `security` CLI tools)
- The keychain access may block when running over SSH - use env vars instead
- Twitter may rotate GraphQL query IDs - update `src/lib/twitter-client.ts` if needed
