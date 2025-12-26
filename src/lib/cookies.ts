/**
 * Browser cookie extraction for Twitter authentication
 * Uses sqlite3 CLI where possible and binarycookies parsing for Safari.
 */

import { execSync } from 'node:child_process';
import { createDecipheriv, pbkdf2Sync } from 'node:crypto';
import { copyFileSync, existsSync, mkdtempSync, readdirSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export interface TwitterCookies {
  authToken: string | null;
  ct0: string | null;
  source: string | null;
}

export interface CookieExtractionResult {
  cookies: TwitterCookies;
  warnings: string[];
}

function normalizeValue(value: unknown): string | null {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }
  return null;
}

function getChromeCookiesPath(profile?: string): string {
  const home = process.env.HOME || '';
  const profileDir = profile || 'Default';
  return join(home, 'Library', 'Application Support', 'Google', 'Chrome', profileDir, 'Cookies');
}

function getFirefoxProfilesRoot(): string | null {
  const home = process.env.HOME || '';
  if (process.platform === 'darwin') {
    return join(home, 'Library', 'Application Support', 'Firefox', 'Profiles');
  }
  if (process.platform === 'linux') {
    return join(home, '.mozilla', 'firefox');
  }
  if (process.platform === 'win32') {
    const appData = process.env.APPDATA;
    if (!appData) return null;
    return join(appData, 'Mozilla', 'Firefox', 'Profiles');
  }
  return null;
}

function pickFirefoxProfile(profilesRoot: string, profile?: string): string | null {
  if (profile) {
    const candidate = join(profilesRoot, profile, 'cookies.sqlite');
    return existsSync(candidate) ? candidate : null;
  }

  const entries = readdirSync(profilesRoot, { withFileTypes: true });
  const defaultRelease = entries.find((entry) => entry.isDirectory() && entry.name.includes('default-release'));
  const targetDir = defaultRelease?.name ?? entries.find((e) => e.isDirectory())?.name;
  if (!targetDir) return null;

  const candidate = join(profilesRoot, targetDir, 'cookies.sqlite');
  return existsSync(candidate) ? candidate : null;
}

function getFirefoxCookiesPath(profile?: string): string | null {
  const profilesRoot = getFirefoxProfilesRoot();
  if (!profilesRoot || !existsSync(profilesRoot)) return null;
  return pickFirefoxProfile(profilesRoot, profile);
}

function getSafariCookiesPath(): string | null {
  if (process.platform !== 'darwin') return null;
  const home = process.env.HOME || '';
  const candidates = [
    join(home, 'Library', 'Cookies', 'Cookies.binarycookies'),
    join(home, 'Library', 'Containers', 'com.apple.Safari', 'Data', 'Library', 'Cookies', 'Cookies.binarycookies'),
  ];
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

const SAFARI_COOKIE_NAMES = new Set(['auth_token', 'ct0']);
const SAFARI_COOKIE_DOMAINS = ['x.com', 'twitter.com'];
const SAFARI_PAGE_SIGNATURE = Buffer.from([0x00, 0x00, 0x01, 0x00]);

function matchesSafariDomain(domain: string | null): boolean {
  if (!domain) return false;
  const normalized = (domain.startsWith('.') ? domain.slice(1) : domain).toLowerCase();
  return SAFARI_COOKIE_DOMAINS.some((target) => normalized === target || normalized.endsWith(`.${target}`));
}

function readSafariCString(buffer: Buffer, start: number, end: number): string | null {
  if (start < 0 || start >= end) return null;
  let cursor = start;
  while (cursor < end && buffer[cursor] !== 0) cursor += 1;
  if (cursor >= end) return null;
  return buffer.toString('utf8', start, cursor);
}

function parseSafariCookieRecord(page: Buffer, offset: number, cookies: TwitterCookies): void {
  if (offset < 0 || offset + 4 > page.length) return;
  const recordSize = page.readUInt32LE(offset);
  const recordEnd = offset + recordSize;
  if (recordSize <= 0 || recordEnd > page.length) return;

  const headerStart = offset + 4;
  const headerSize = 4 + 4 + 4 + 4 + 4 + 4 + 4; // unknown1 + flags + unknown2 + domain + name + path + value
  if (headerStart + headerSize > recordEnd) return;

  const domainOffset = page.readUInt32LE(headerStart + 12);
  const nameOffset = page.readUInt32LE(headerStart + 16);
  const valueOffset = page.readUInt32LE(headerStart + 24);

  const domain = readSafariCString(page, offset + domainOffset, recordEnd);
  const name = readSafariCString(page, offset + nameOffset, recordEnd);
  const value = readSafariCString(page, offset + valueOffset, recordEnd);

  if (!name || !value || !matchesSafariDomain(domain)) return;
  if (!SAFARI_COOKIE_NAMES.has(name)) return;

  const normalizedValue = normalizeValue(value);
  if (!normalizedValue) return;

  if (name === 'auth_token' && !cookies.authToken) {
    cookies.authToken = normalizedValue;
  } else if (name === 'ct0' && !cookies.ct0) {
    cookies.ct0 = normalizedValue;
  }
}

function parseSafariCookiePage(page: Buffer, cookies: TwitterCookies): void {
  if (page.length < 12) return;
  if (!page.subarray(0, 4).equals(SAFARI_PAGE_SIGNATURE)) return;
  const cookieCount = page.readUInt32LE(4);
  if (!cookieCount) return;

  const offsets: number[] = [];
  let cursor = 8;
  for (let i = 0; i < cookieCount; i += 1) {
    if (cursor + 4 > page.length) return;
    offsets.push(page.readUInt32LE(cursor));
    cursor += 4;
  }

  for (const offset of offsets) {
    parseSafariCookieRecord(page, offset, cookies);
    if (cookies.authToken && cookies.ct0) return;
  }
}

function parseSafariCookies(data: Buffer, cookies: TwitterCookies): void {
  if (data.length < 8) return;
  if (data.subarray(0, 4).toString('utf8') !== 'cook') return;
  const pageCount = data.readUInt32BE(4);
  let cursor = 8;
  const pageSizes: number[] = [];
  for (let i = 0; i < pageCount; i += 1) {
    if (cursor + 4 > data.length) return;
    pageSizes.push(data.readUInt32BE(cursor));
    cursor += 4;
  }

  for (const pageSize of pageSizes) {
    if (cursor + pageSize > data.length) return;
    const page = data.subarray(cursor, cursor + pageSize);
    parseSafariCookiePage(page, cookies);
    if (cookies.authToken && cookies.ct0) return;
    cursor += pageSize;
  }
}

/**
 * Extract Twitter cookies from Safari browser using Cookies.binarycookies
 */
export async function extractCookiesFromSafari(): Promise<CookieExtractionResult> {
  const warnings: string[] = [];
  const cookies: TwitterCookies = {
    authToken: null,
    ct0: null,
    source: null,
  };

  const cookiesPath = getSafariCookiesPath();
  if (!cookiesPath) {
    warnings.push('Safari cookies database not found.');
    return { cookies, warnings };
  }

  let tempDir: string | null = null;

  try {
    tempDir = mkdtempSync(join(tmpdir(), 'twitter-cli-'));
    const tempCookiesPath = join(tempDir, 'Cookies.binarycookies');
    copyFileSync(cookiesPath, tempCookiesPath);
    const data = readFileSync(tempCookiesPath);
    parseSafariCookies(data, cookies);

    if (cookies.authToken || cookies.ct0) {
      cookies.source = 'Safari';
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    warnings.push(`Failed to read Safari cookies: ${message}`);
  } finally {
    if (tempDir) {
      try {
        rmSync(tempDir, { recursive: true, force: true });
      } catch {
        // ignore cleanup errors
      }
    }
  }

  if (!cookies.authToken && !cookies.ct0) {
    warnings.push('No Twitter cookies found in Safari. Make sure you are logged into x.com in Safari.');
  }

  return { cookies, warnings };
}

/**
 * Decrypt Chrome cookie value using macOS keychain
 * Chrome encrypts cookies with a key stored in the keychain
 */
function decryptCookieValue(encryptedHex: string): string | null {
  try {
    // Convert hex to buffer
    const encryptedValue = Buffer.from(encryptedHex, 'hex');

    if (encryptedValue.length < 4) {
      return null;
    }

    const version = encryptedValue.subarray(0, 3).toString('utf8');
    if (version !== 'v10' && version !== 'v11') {
      // Not encrypted, just return as string
      return encryptedValue.toString('utf8');
    }

    // Get encryption key from keychain
    const keyOutput = execSync('security find-generic-password -s "Chrome Safe Storage" -w 2>/dev/null || echo ""', {
      encoding: 'utf8',
    }).trim();

    if (!keyOutput) {
      return null;
    }

    // Derive the key using PBKDF2
    const salt = 'saltysalt';
    const iterations = 1003;
    const keyLength = 16;

    const derivedKey = pbkdf2Sync(keyOutput, salt, iterations, keyLength, 'sha1');

    // Decrypt using AES-128-CBC with empty IV (16 bytes of 0x20/space)
    const iv = Buffer.alloc(16, 0x20);
    const encryptedData = encryptedValue.subarray(3); // Skip "v10" or "v11" prefix

    const decipher = createDecipheriv('aes-128-cbc', derivedKey, iv);
    decipher.setAutoPadding(true);

    let decrypted = decipher.update(encryptedData);
    decrypted = Buffer.concat([decrypted, decipher.final()]);

    // Chrome v10 cookies have key material prepended before the actual value
    // Twitter cookies are hex strings, so extract the longest hex sequence
    const decryptedStr = decrypted.toString('utf8');
    const hexMatch = decryptedStr.match(/[a-f0-9]{32,}/i);
    if (hexMatch) {
      return hexMatch[0];
    }
    // Fallback: keep only printable ASCII characters
    return decryptedStr.replace(/[^\x20-\x7E]/g, '');
  } catch {
    return null;
  }
}

/**
 * Extract Twitter cookies from Chrome browser using sqlite3 CLI
 * @param profile - Chrome profile name (optional, uses Default if not specified)
 */
export async function extractCookiesFromChrome(profile?: string): Promise<CookieExtractionResult> {
  const warnings: string[] = [];
  const cookies: TwitterCookies = {
    authToken: null,
    ct0: null,
    source: null,
  };

  const cookiesPath = getChromeCookiesPath(profile);

  if (!existsSync(cookiesPath)) {
    warnings.push(`Chrome cookies database not found at: ${cookiesPath}`);
    return { cookies, warnings };
  }

  // Chrome locks the database, so we need to copy it
  let tempDir: string | null = null;

  try {
    tempDir = mkdtempSync(join(tmpdir(), 'twitter-cli-'));
    const tempDbPath = join(tempDir, 'Cookies');
    copyFileSync(cookiesPath, tempDbPath);

    // Also copy the WAL and SHM files if they exist
    const walPath = `${cookiesPath}-wal`;
    const shmPath = `${cookiesPath}-shm`;
    if (existsSync(walPath)) {
      copyFileSync(walPath, `${tempDbPath}-wal`);
    }
    if (existsSync(shmPath)) {
      copyFileSync(shmPath, `${tempDbPath}-shm`);
    }

    // Use sqlite3 CLI to query cookies (no native deps required!)
    const query = `SELECT name, hex(encrypted_value) as encrypted_hex FROM cookies WHERE host_key IN ('.x.com', '.twitter.com', 'x.com', 'twitter.com') AND name IN ('auth_token', 'ct0');`;

    const result = execSync(`sqlite3 -separator '|' "${tempDbPath}" "${query}"`, {
      encoding: 'utf8',
      maxBuffer: 1024 * 1024,
    }).trim();

    if (result) {
      for (const line of result.split('\n')) {
        const [name, encryptedHex] = line.split('|');
        if (!name || !encryptedHex) continue;

        const decryptedValue = decryptCookieValue(encryptedHex);
        if (decryptedValue) {
          if (name === 'auth_token' && !cookies.authToken) {
            cookies.authToken = decryptedValue;
          } else if (name === 'ct0' && !cookies.ct0) {
            cookies.ct0 = decryptedValue;
          }
        }
      }
    }

    if (cookies.authToken || cookies.ct0) {
      cookies.source = profile ? `Chrome profile "${profile}"` : 'Chrome default profile';
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    warnings.push(`Failed to read Chrome cookies: ${message}`);
  } finally {
    // Cleanup temp files
    if (tempDir) {
      try {
        rmSync(tempDir, { recursive: true, force: true });
      } catch {
        // Ignore cleanup errors
      }
    }
  }

  if (!cookies.authToken && !cookies.ct0) {
    warnings.push('No Twitter cookies found in Chrome. Make sure you are logged into x.com in Chrome.');
  }

  return { cookies, warnings };
}

/**
 * Extract Twitter cookies from Firefox browser using sqlite3 CLI
 * @param profile - Firefox profile directory name (optional, auto-detected)
 */
export async function extractCookiesFromFirefox(profile?: string): Promise<CookieExtractionResult> {
  const warnings: string[] = [];
  const cookies: TwitterCookies = {
    authToken: null,
    ct0: null,
    source: null,
  };

  const cookiesPath = getFirefoxCookiesPath(profile);

  if (!cookiesPath) {
    warnings.push('Firefox cookies database not found.');
    return { cookies, warnings };
  }

  let tempDir: string | null = null;

  try {
    tempDir = mkdtempSync(join(tmpdir(), 'twitter-cli-'));
    const tempDbPath = join(tempDir, 'cookies.sqlite');
    copyFileSync(cookiesPath, tempDbPath);

    const query = `SELECT name, value FROM moz_cookies WHERE host IN ('.x.com', '.twitter.com', 'x.com', 'twitter.com') AND name IN ('auth_token', 'ct0');`;

    const result = execSync(`sqlite3 -separator '|' "${tempDbPath}" "${query}"`, {
      encoding: 'utf8',
      maxBuffer: 1024 * 1024,
    }).trim();

    if (result) {
      for (const line of result.split('\n')) {
        const [name, value] = line.split('|');
        if (!name || !value) continue;
        if (name === 'auth_token' && !cookies.authToken) {
          cookies.authToken = value;
        } else if (name === 'ct0' && !cookies.ct0) {
          cookies.ct0 = value;
        }
      }
    }

    if (cookies.authToken || cookies.ct0) {
      cookies.source = profile ? `Firefox profile "${profile}"` : 'Firefox default profile';
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    warnings.push(`Failed to read Firefox cookies: ${message}`);
  } finally {
    if (tempDir) {
      try {
        rmSync(tempDir, { recursive: true, force: true });
      } catch {
        // ignore cleanup errors
      }
    }
  }

  if (!cookies.authToken && !cookies.ct0) {
    warnings.push(
      'No Twitter cookies found in Firefox. Make sure you are logged into x.com in Firefox and the profile exists.',
    );
  }

  return { cookies, warnings };
}

/**
 * Resolve Twitter credentials from multiple sources
 * Priority: CLI args > environment variables > Safari > Chrome > Firefox
 */
export async function resolveCredentials(options: {
  authToken?: string;
  ct0?: string;
  allowSafari?: boolean;
  chromeProfile?: string;
  firefoxProfile?: string;
  allowChrome?: boolean;
  allowFirefox?: boolean;
}): Promise<CookieExtractionResult> {
  const warnings: string[] = [];
  const cookies: TwitterCookies = {
    authToken: null,
    ct0: null,
    source: null,
  };

  // 1. CLI arguments (highest priority)
  if (options.authToken) {
    cookies.authToken = options.authToken;
    cookies.source = 'CLI argument';
  }
  if (options.ct0) {
    cookies.ct0 = options.ct0;
    if (!cookies.source) cookies.source = 'CLI argument';
  }

  // 2. Environment variables
  const envAuthKeys = ['AUTH_TOKEN', 'TWITTER_AUTH_TOKEN'];
  const envCt0Keys = ['CT0', 'TWITTER_CT0'];

  if (!cookies.authToken) {
    for (const key of envAuthKeys) {
      const value = normalizeValue(process.env[key]);
      if (value) {
        cookies.authToken = value;
        cookies.source = `env ${key}`;
        break;
      }
    }
  }

  if (!cookies.ct0) {
    for (const key of envCt0Keys) {
      const value = normalizeValue(process.env[key]);
      if (value) {
        cookies.ct0 = value;
        if (!cookies.source) cookies.source = `env ${key}`;
        break;
      }
    }
  }

  const allowSafari = options.allowSafari ?? true;
  const allowChrome = options.allowChrome ?? true;
  const allowFirefox = options.allowFirefox ?? true;

  // 3. Safari cookies (preferred browser fallback)
  if (allowSafari && (!cookies.authToken || !cookies.ct0)) {
    const safariResult = await extractCookiesFromSafari();
    warnings.push(...safariResult.warnings);

    if (!cookies.authToken && safariResult.cookies.authToken) {
      cookies.authToken = safariResult.cookies.authToken;
      cookies.source = safariResult.cookies.source;
    }
    if (!cookies.ct0 && safariResult.cookies.ct0) {
      cookies.ct0 = safariResult.cookies.ct0;
      if (!cookies.source) cookies.source = safariResult.cookies.source;
    }
  }

  // 4. Chrome cookies (secondary browser fallback)
  if (allowChrome && (!cookies.authToken || !cookies.ct0)) {
    const chromeResult = await extractCookiesFromChrome(options.chromeProfile);
    warnings.push(...chromeResult.warnings);

    if (!cookies.authToken && chromeResult.cookies.authToken) {
      cookies.authToken = chromeResult.cookies.authToken;
      cookies.source = chromeResult.cookies.source;
    }
    if (!cookies.ct0 && chromeResult.cookies.ct0) {
      cookies.ct0 = chromeResult.cookies.ct0;
      if (!cookies.source) cookies.source = chromeResult.cookies.source;
    }
  }

  // 5. Firefox cookies (tertiary browser fallback)
  if (allowFirefox && (!cookies.authToken || !cookies.ct0)) {
    const firefoxResult = await extractCookiesFromFirefox(options.firefoxProfile);
    warnings.push(...firefoxResult.warnings);

    if (!cookies.authToken && firefoxResult.cookies.authToken) {
      cookies.authToken = firefoxResult.cookies.authToken;
      cookies.source = firefoxResult.cookies.source;
    }
    if (!cookies.ct0 && firefoxResult.cookies.ct0) {
      cookies.ct0 = firefoxResult.cookies.ct0;
      if (!cookies.source) cookies.source = firefoxResult.cookies.source;
    }
  }

  // Validation
  if (!cookies.authToken) {
    warnings.push(
      'Missing auth_token - provide via --auth-token, AUTH_TOKEN env var, or login to x.com in Safari/Chrome/Firefox',
    );
  }
  if (!cookies.ct0) {
    warnings.push('Missing ct0 - provide via --ct0, CT0 env var, or login to x.com in Safari/Chrome/Firefox');
  }

  return { cookies, warnings };
}
