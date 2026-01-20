/**
 * Supported translation providers.
 * - AI providers (openai, anthropic) use LLMs for context-aware translation
 * - API providers (google, deepl, azure) use dedicated translation services
 * - Local (libre) for self-hosted/offline translation
 * - Custom for arbitrary endpoints
 */
export type TranslationProvider =
  | 'openai' // OpenAI GPT models
  | 'anthropic' // Claude models
  | 'google' // Google Cloud Translation API
  | 'deepl' // DeepL API
  | 'azure' // Azure Cognitive Services
  | 'libre' // LibreTranslate (local/self-hosted)
  | 'custom'; // Custom endpoint

/**
 * Configuration options for creating a translation service.
 */
export interface TranslationOptions {
  /** Translation provider to use */
  provider: TranslationProvider;
  /** API key for the service (required for most providers) */
  apiKey?: string;
  /** Custom API endpoint (for custom/self-hosted providers) */
  apiEndpoint?: string;
  /** Model name for AI providers (e.g., "gpt-4o-mini", "claude-sonnet-4-20250514") */
  model?: string;
}

/**
 * Result of a translation operation.
 */
export interface TranslationResult {
  /** Whether the translation succeeded */
  success: boolean;
  /** Translated text (present on success) */
  translatedText?: string;
  /** Detected source language code if provider supports auto-detection */
  detectedSourceLang?: string;
  /** Error message (present on failure) */
  error?: string;
}

/**
 * Interface for translation service implementations.
 * Each provider (OpenAI, Anthropic, etc.) implements this interface.
 */
export interface TranslationService {
  /** Human-readable name of the service */
  name: string;
  /** Whether this service can auto-detect source language */
  supportsLanguageDetection: boolean;

  /**
   * Translate text to the target language.
   * @param text - Text to translate
   * @param targetLang - Target language code (e.g., "en", "zh", "uk")
   * @param sourceLang - Optional source language code; if omitted, auto-detect
   * @returns Translation result
   */
  translate(text: string, targetLang: string, sourceLang?: string): Promise<TranslationResult>;
}
