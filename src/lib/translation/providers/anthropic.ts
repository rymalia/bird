import type { TranslationOptions, TranslationResult, TranslationService } from '../types.js';

interface AnthropicMessage {
  role: 'user' | 'assistant';
  content: string;
}

interface AnthropicResponse {
  id?: string;
  type?: string;
  content?: Array<{
    type: 'text';
    text: string;
  }>;
  stop_reason?: string;
  error?: {
    type?: string;
    message?: string;
  };
}

/**
 * Translation service using Anthropic's Claude models.
 *
 * Uses the messages API with a translation-focused prompt.
 * Claude excels at nuanced translations and handling longer text.
 */
export class AnthropicTranslationService implements TranslationService {
  readonly name = 'Anthropic';
  readonly supportsLanguageDetection = true;

  private readonly apiKey: string;
  private readonly model: string;
  private readonly apiEndpoint: string;

  constructor(options: TranslationOptions) {
    if (!options.apiKey) {
      throw new Error('Anthropic translation requires an API key');
    }
    this.apiKey = options.apiKey;
    this.model = options.model ?? 'claude-sonnet-4-20250514';
    this.apiEndpoint = options.apiEndpoint ?? 'https://api.anthropic.com/v1/messages';
  }

  async translate(text: string, targetLang: string, sourceLang?: string): Promise<TranslationResult> {
    const langHint = sourceLang ? ` from ${sourceLang}` : '';
    const systemPrompt = `You are a professional translator. Translate the following text${langHint} to ${targetLang}. Return ONLY the translation, with no explanations, preamble, or quotation marks around the result.`;

    const messages: AnthropicMessage[] = [{ role: 'user', content: text }];

    try {
      const response = await fetch(this.apiEndpoint, {
        method: 'POST',
        headers: {
          'x-api-key': this.apiKey,
          'Content-Type': 'application/json',
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: this.model,
          max_tokens: Math.max(1024, text.length * 2),
          system: systemPrompt,
          messages,
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        return {
          success: false,
          error: `Anthropic API error (${response.status}): ${errorText}`,
        };
      }

      const data = (await response.json()) as AnthropicResponse;

      if (data.error) {
        return {
          success: false,
          error: `Anthropic error: ${data.error.message ?? data.error.type ?? 'Unknown error'}`,
        };
      }

      const textContent = data.content?.find((c) => c.type === 'text');
      const translatedText = textContent?.text?.trim();

      if (!translatedText) {
        return {
          success: false,
          error: 'Anthropic returned empty translation',
        };
      }

      return {
        success: true,
        translatedText,
      };
    } catch (error) {
      return {
        success: false,
        error: `Anthropic request failed: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }
}
