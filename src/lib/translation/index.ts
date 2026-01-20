export { AnthropicTranslationService } from './providers/anthropic.js';
export { OpenAITranslationService } from './providers/openai.js';
export type {
  TranslationOptions,
  TranslationProvider,
  TranslationResult,
  TranslationService,
} from './types.js';

import { AnthropicTranslationService } from './providers/anthropic.js';
import { OpenAITranslationService } from './providers/openai.js';
import type { TranslationOptions, TranslationService } from './types.js';

/**
 * Creates a translation service instance based on the specified provider.
 *
 * @param options - Configuration options including provider type and credentials
 * @returns A translation service instance
 * @throws Error if the provider is not supported or missing required config
 *
 * @example
 * ```ts
 * const service = createTranslationService({
 *   provider: 'openai',
 *   apiKey: process.env.OPENAI_KEY,
 *   model: 'gpt-4o-mini',
 * });
 *
 * const result = await service.translate('Bonjour le monde', 'en');
 * ```
 */
export function createTranslationService(options: TranslationOptions): TranslationService {
  switch (options.provider) {
    case 'openai':
      return new OpenAITranslationService(options);

    case 'anthropic':
      return new AnthropicTranslationService(options);

    case 'google':
    case 'deepl':
    case 'azure':
    case 'libre':
    case 'custom':
      throw new Error(
        `Translation provider "${options.provider}" is not yet implemented. Available providers: openai, anthropic`,
      );
  }
}

/**
 * List of currently supported translation providers.
 */
export const SUPPORTED_PROVIDERS = ['openai', 'anthropic'] as const;
