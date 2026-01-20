import { describe, expect, it, vi } from 'vitest';
import {
  createTranslationService,
  SUPPORTED_PROVIDERS,
  type TranslationOptions,
} from '../src/lib/translation/index.js';
import { AnthropicTranslationService } from '../src/lib/translation/providers/anthropic.js';
import { OpenAITranslationService } from '../src/lib/translation/providers/openai.js';

describe('translation service', () => {
  describe('createTranslationService factory', () => {
    it('creates OpenAI service when provider is openai', () => {
      const service = createTranslationService({
        provider: 'openai',
        apiKey: 'test-key',
      });
      expect(service).toBeInstanceOf(OpenAITranslationService);
      expect(service.name).toBe('OpenAI');
    });

    it('creates Anthropic service when provider is anthropic', () => {
      const service = createTranslationService({
        provider: 'anthropic',
        apiKey: 'test-key',
      });
      expect(service).toBeInstanceOf(AnthropicTranslationService);
      expect(service.name).toBe('Anthropic');
    });

    it('throws for unsupported providers', () => {
      expect(() =>
        createTranslationService({
          provider: 'google' as TranslationOptions['provider'],
          apiKey: 'test-key',
        }),
      ).toThrow('not yet implemented');
    });

    // Note: Unknown providers are now prevented by TypeScript at compile time
    // since the switch statement exhaustively handles all TranslationProvider values
  });

  describe('SUPPORTED_PROVIDERS', () => {
    it('exports supported providers list', () => {
      expect(SUPPORTED_PROVIDERS).toEqual(['openai', 'anthropic']);
    });
  });

  describe('OpenAITranslationService', () => {
    it('requires API key', () => {
      expect(() => new OpenAITranslationService({ provider: 'openai' })).toThrow(
        'OpenAI translation requires an API key',
      );
    });

    it('supports language detection', () => {
      const service = new OpenAITranslationService({
        provider: 'openai',
        apiKey: 'test-key',
      });
      expect(service.supportsLanguageDetection).toBe(true);
    });

    it('uses default model when not specified', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          choices: [{ message: { content: 'Hello world' } }],
        }),
      });
      vi.stubGlobal('fetch', mockFetch);

      const service = new OpenAITranslationService({
        provider: 'openai',
        apiKey: 'test-key',
      });
      await service.translate('Bonjour le monde', 'en');

      expect(mockFetch).toHaveBeenCalledTimes(1);
      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.model).toBe('gpt-4o-mini');

      vi.unstubAllGlobals();
    });

    it('uses custom model when specified', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          choices: [{ message: { content: 'Hello world' } }],
        }),
      });
      vi.stubGlobal('fetch', mockFetch);

      const service = new OpenAITranslationService({
        provider: 'openai',
        apiKey: 'test-key',
        model: 'gpt-4o',
      });
      await service.translate('Bonjour le monde', 'en');

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.model).toBe('gpt-4o');

      vi.unstubAllGlobals();
    });

    it('returns translated text on success', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          choices: [{ message: { content: 'Hello world' } }],
        }),
      });
      vi.stubGlobal('fetch', mockFetch);

      const service = new OpenAITranslationService({
        provider: 'openai',
        apiKey: 'test-key',
      });
      const result = await service.translate('Bonjour le monde', 'en');

      expect(result.success).toBe(true);
      expect(result.translatedText).toBe('Hello world');

      vi.unstubAllGlobals();
    });

    it('handles API errors', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        text: async () => 'Invalid API key',
      });
      vi.stubGlobal('fetch', mockFetch);

      const service = new OpenAITranslationService({
        provider: 'openai',
        apiKey: 'invalid-key',
      });
      const result = await service.translate('Bonjour', 'en');

      expect(result.success).toBe(false);
      expect(result.error).toContain('401');
      expect(result.error).toContain('Invalid API key');

      vi.unstubAllGlobals();
    });

    it('handles error responses', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          error: { message: 'Rate limit exceeded', type: 'rate_limit_error' },
        }),
      });
      vi.stubGlobal('fetch', mockFetch);

      const service = new OpenAITranslationService({
        provider: 'openai',
        apiKey: 'test-key',
      });
      const result = await service.translate('Bonjour', 'en');

      expect(result.success).toBe(false);
      expect(result.error).toContain('Rate limit exceeded');

      vi.unstubAllGlobals();
    });

    it('handles empty responses', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ choices: [] }),
      });
      vi.stubGlobal('fetch', mockFetch);

      const service = new OpenAITranslationService({
        provider: 'openai',
        apiKey: 'test-key',
      });
      const result = await service.translate('Bonjour', 'en');

      expect(result.success).toBe(false);
      expect(result.error).toContain('empty translation');

      vi.unstubAllGlobals();
    });

    it('handles network errors', async () => {
      const mockFetch = vi.fn().mockRejectedValue(new Error('Network error'));
      vi.stubGlobal('fetch', mockFetch);

      const service = new OpenAITranslationService({
        provider: 'openai',
        apiKey: 'test-key',
      });
      const result = await service.translate('Bonjour', 'en');

      expect(result.success).toBe(false);
      expect(result.error).toContain('Network error');

      vi.unstubAllGlobals();
    });

    it('includes source language hint when provided', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          choices: [{ message: { content: 'Hello' } }],
        }),
      });
      vi.stubGlobal('fetch', mockFetch);

      const service = new OpenAITranslationService({
        provider: 'openai',
        apiKey: 'test-key',
      });
      await service.translate('Bonjour', 'en', 'fr');

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.messages[0].content).toContain('from fr');

      vi.unstubAllGlobals();
    });
  });

  describe('AnthropicTranslationService', () => {
    it('requires API key', () => {
      expect(() => new AnthropicTranslationService({ provider: 'anthropic' })).toThrow(
        'Anthropic translation requires an API key',
      );
    });

    it('supports language detection', () => {
      const service = new AnthropicTranslationService({
        provider: 'anthropic',
        apiKey: 'test-key',
      });
      expect(service.supportsLanguageDetection).toBe(true);
    });

    it('uses default model when not specified', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          content: [{ type: 'text', text: 'Hello world' }],
        }),
      });
      vi.stubGlobal('fetch', mockFetch);

      const service = new AnthropicTranslationService({
        provider: 'anthropic',
        apiKey: 'test-key',
      });
      await service.translate('Bonjour le monde', 'en');

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.model).toBe('claude-sonnet-4-20250514');

      vi.unstubAllGlobals();
    });

    it('uses correct API headers', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          content: [{ type: 'text', text: 'Hello world' }],
        }),
      });
      vi.stubGlobal('fetch', mockFetch);

      const service = new AnthropicTranslationService({
        provider: 'anthropic',
        apiKey: 'test-key',
      });
      await service.translate('Bonjour', 'en');

      const headers = mockFetch.mock.calls[0][1].headers;
      expect(headers['x-api-key']).toBe('test-key');
      expect(headers['anthropic-version']).toBe('2023-06-01');

      vi.unstubAllGlobals();
    });

    it('returns translated text on success', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          content: [{ type: 'text', text: 'Hello world' }],
        }),
      });
      vi.stubGlobal('fetch', mockFetch);

      const service = new AnthropicTranslationService({
        provider: 'anthropic',
        apiKey: 'test-key',
      });
      const result = await service.translate('Bonjour le monde', 'en');

      expect(result.success).toBe(true);
      expect(result.translatedText).toBe('Hello world');

      vi.unstubAllGlobals();
    });

    it('handles API errors', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        text: async () => 'Invalid API key',
      });
      vi.stubGlobal('fetch', mockFetch);

      const service = new AnthropicTranslationService({
        provider: 'anthropic',
        apiKey: 'invalid-key',
      });
      const result = await service.translate('Bonjour', 'en');

      expect(result.success).toBe(false);
      expect(result.error).toContain('401');

      vi.unstubAllGlobals();
    });

    it('handles error responses', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          error: { message: 'Rate limit exceeded', type: 'rate_limit_error' },
        }),
      });
      vi.stubGlobal('fetch', mockFetch);

      const service = new AnthropicTranslationService({
        provider: 'anthropic',
        apiKey: 'test-key',
      });
      const result = await service.translate('Bonjour', 'en');

      expect(result.success).toBe(false);
      expect(result.error).toContain('Rate limit exceeded');

      vi.unstubAllGlobals();
    });

    it('handles empty responses', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ content: [] }),
      });
      vi.stubGlobal('fetch', mockFetch);

      const service = new AnthropicTranslationService({
        provider: 'anthropic',
        apiKey: 'test-key',
      });
      const result = await service.translate('Bonjour', 'en');

      expect(result.success).toBe(false);
      expect(result.error).toContain('empty translation');

      vi.unstubAllGlobals();
    });

    it('handles network errors', async () => {
      const mockFetch = vi.fn().mockRejectedValue(new Error('Connection refused'));
      vi.stubGlobal('fetch', mockFetch);

      const service = new AnthropicTranslationService({
        provider: 'anthropic',
        apiKey: 'test-key',
      });
      const result = await service.translate('Bonjour', 'en');

      expect(result.success).toBe(false);
      expect(result.error).toContain('Connection refused');

      vi.unstubAllGlobals();
    });
  });
});
