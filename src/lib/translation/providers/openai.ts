import type { TranslationOptions, TranslationResult, TranslationService } from '../types.js';

interface OpenAIChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

interface OpenAIChatResponse {
  id?: string;
  choices?: Array<{
    message?: {
      content?: string;
    };
    finish_reason?: string;
  }>;
  error?: {
    message?: string;
    type?: string;
    code?: string;
  };
}

/**
 * Translation service using OpenAI's GPT models.
 *
 * Uses the chat completions API with a translation-focused prompt.
 * GPT models excel at context-aware translation with natural language output.
 */
export class OpenAITranslationService implements TranslationService {
  readonly name = 'OpenAI';
  readonly supportsLanguageDetection = true;

  private readonly apiKey: string;
  private readonly model: string;
  private readonly apiEndpoint: string;

  constructor(options: TranslationOptions) {
    if (!options.apiKey) {
      throw new Error('OpenAI translation requires an API key');
    }
    this.apiKey = options.apiKey;
    this.model = options.model ?? 'gpt-4o-mini';
    this.apiEndpoint = options.apiEndpoint ?? 'https://api.openai.com/v1/chat/completions';
  }

  async translate(text: string, targetLang: string, sourceLang?: string): Promise<TranslationResult> {
    const langHint = sourceLang ? ` from ${sourceLang}` : '';
    const systemPrompt = `You are a professional translator. Translate the following text${langHint} to ${targetLang}. Return ONLY the translation, with no explanations, preamble, or quotation marks around the result.`;

    const messages: OpenAIChatMessage[] = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: text },
    ];

    try {
      const response = await fetch(this.apiEndpoint, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: this.model,
          messages,
          temperature: 0.3,
          max_tokens: Math.max(1024, text.length * 2),
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        return {
          success: false,
          error: `OpenAI API error (${response.status}): ${errorText}`,
        };
      }

      const data = (await response.json()) as OpenAIChatResponse;

      if (data.error) {
        return {
          success: false,
          error: `OpenAI error: ${data.error.message ?? data.error.type ?? 'Unknown error'}`,
        };
      }

      const translatedText = data.choices?.[0]?.message?.content?.trim();

      if (!translatedText) {
        return {
          success: false,
          error: 'OpenAI returned empty translation',
        };
      }

      return {
        success: true,
        translatedText,
      };
    } catch (error) {
      return {
        success: false,
        error: `OpenAI request failed: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }
}
