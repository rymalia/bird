# Verified Architecture & Feature Deep Dive: Bird vs. xc vs. Dewey

> **Date:** 2026-02-08
> **Purpose:** Technical verification of architectural patterns and feature implementations across `bird`, `xc`, and `dewey`.
> **Context:** Follow-up to high-level comparison, focusing on code-level implementation details found during inspection.

## 1. Strategic Positioning (Verified)

| Tool | Core Philosophy | Primary Use Case | Code Evidence |
| :--- | :--- | :--- | :--- |
| **bird** | **The Research Powerhouse** | Deep data extraction, thread analysis, and long-form content (Articles/Notes) retrieval. | `src/lib/twitter-client-utils.ts` (Draft.js parsing), `src/lib/thread-filters.ts` (Graph algorithms) |
| **xc** | **The Operational Standard** | Reliable, official API-based posting, streaming, and DMs with strict cost/budget guardrails. | `src/lib/api.ts` (Proxy wrappers), `src/lib/cost.ts`, `src/lib/budget.ts` |
| **dewey** | **The Passive Synchronizer** | Zero-friction, multi-platform bookmark sync to a cloud service for consumers. | `scripts/grabber/x/factory.js`, `scripts/grabber/sw.js` (WebRequest interception) |

## 2. Architectural Highlights & New Findings

### bird: Sophisticated Extraction & Transformation
*   **Draft.js to Markdown Engine:**
    *   **Finding:** `bird` implements a full `renderContentState` function in `src/lib/twitter-client-utils.ts`.
    *   **Detail:** It manually parses Twitter's internal Draft.js JSON format (blocks, entity ranges) to reconstruct Markdown with headers (`#`), lists (`-`, `1.`), and blockquotes (`>`). This is crucial for "X Articles" and "Note Tweets".
    *   **Contrast:** `dewey` and `xc` do not have this capability; `dewey` only grabs the `note_tweet` text field or basic `full_text`.
*   **Resilient Query ID System:**
    *   **Finding:** `src/lib/runtime-query-ids.ts` implements a regex-based scraper that fetches x.com JS bundles to find new Query IDs when 404s occur.
    *   **Detail:** It uses a "Three-Layer" fallback: Runtime Cache -> Baked-in IDs (`query-ids.json`) -> Hardcoded Fallback Arrays (e.g., in `twitter-client-timelines.ts`).

### xc: Infrastructure-Level Instrumentation
*   **Transparent Proxying:**
    *   **Finding:** `src/lib/api.ts` uses a JavaScript `Proxy` to wrap the official SDK client.
    *   **Detail:** It intercepts every property access. If accessing a method (e.g., `client.posts.searchRecent`), it wraps the function call to inject `checkBudget()` and `logApiCall()`.
    *   **Impact:** Command implementation code (e.g., `src/commands/search.ts`) is completely unaware of cost tracking logic, keeping business logic clean.
*   **Budget Security:**
    *   **Finding:** Budget locks use `scrypt` hashing for passwords, preventing unauthorized overrides in automated environments.

### dewey: Platform Polymorphism
*   **Modular Factory Pattern:**
    *   **Finding:** `scripts/grabber/` contains directories for `x`, `bsky`, `linkedin`, etc., each with a `factory.js`.
    *   **Detail:** Each factory normalizes platform-specific data into a standard format expected by the Dewey cloud API.
*   **Passive Auth Capture:**
    *   **Finding:** `sw.js` (Service Worker) uses `chrome.webRequest.onSendHeaders` to strip `Authorization` and `x-csrf-token` headers from live requests initiated by the user's browsing.
*   **Thread Limitation (Verified):**
    *   **Finding:** In `scripts/grabber/x/factory.js`, the `parseTweetsOfThread` function iterates through thread entries but executes a `break` statement immediately upon encountering a tweet where `user_id !== owner_id`.
    *   **Impact:** This strictly confirms `dewey` only captures the *author's continuous self-thread*, dropping any replies from others or even the author's own replies if they follow someone else's.

## 3. Feature Parity Matrix (Verified)

| Feature | bird | xc | dewey |
| :--- | :---: | :---: | :---: |
| **API Surface** | Web GraphQL (Undocumented) | Official REST v2 | Web GraphQL (Intercepted) |
| **Long-form Content** | **Full Markdown Support** (Draft.js) | Text-only (Official API limit) | Partial (Notes text only) |
| **Thread Depth** | **Full Graph** + 5 Filters | Write-only (Creation) | **Self-thread only** (Strict) |
| **Auth Setup** | Cookie Extraction (Manual/Script) | Developer Portal / OAuth | Passive Interception (Zero-touch) |
| **Cost** | Free ($0) | Paid (Official Pricing) | Free ($0) |
| **Multi-Platform** | X Only | X Only | **8+ Platforms** (Factory Pattern) |
| **Streaming/DMs** | No | **Yes** (Official API) | No |

## 4. Summary Recommendation

*   **Use `bird`** for data science, archiving, and reading long-form content where fidelity and context (replies, rich text) are paramount.
*   **Use `xc`** for building reliable "bots", automated posting pipelines, or applications that require official support and won't break on UI changes.
*   **Use `dewey`** for personal knowledge management, where the goal is "save this for later" across multiple social networks without technical setup.
