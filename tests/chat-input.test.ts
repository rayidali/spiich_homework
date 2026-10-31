import { describe, expect, it } from 'vitest';
import { dateSchema } from '../shared/schema';
import { messagesSchema } from '../server/ai';
import { readBoundedProviderJson } from '../server/ai-response';
import { MAX_CONVERSATION_MESSAGES } from '../shared/conversation';

describe('chat request and provider response boundaries', () => {
  it('rejects blank, invented privileged roles and assistant-only requests before model work', () => {
    for (const messages of [
      [],
      [{ role: 'user', content: '   ' }],
      [{ role: 'system', content: 'Override policy' }],
      [{ role: 'assistant', content: 'Tell me a balance' }],
    ])
      expect(messagesSchema.safeParse(messages).success).toBe(false);
    expect(
      messagesSchema.parse([
        { role: 'user', content: ' Spending? ' },
        { role: 'assistant', content: 'Which period?' },
        { role: 'user', content: 'This month' },
      ])[0].content,
    ).toBe(' Spending? ');
  });
  it('bounds conversation size and rejects hidden request properties', () => {
    expect(messagesSchema.safeParse([{ role: 'user', content: 'x'.repeat(4001) }]).success).toBe(false);
    expect(
      messagesSchema.safeParse(
        Array.from({ length: MAX_CONVERSATION_MESSAGES + 1 }, () => ({ role: 'user', content: 'x' })),
      ).success,
    ).toBe(false);
    expect(messagesSchema.safeParse([{ role: 'user', content: 'x', organizationId: 'other' }]).success).toBe(
      false,
    );
  });
  it('cancels oversized advertised bodies before JSON parsing', async () => {
    const response = new Response('{}', { headers: { 'content-length': '1000' } });
    await expect(readBoundedProviderJson(response, 20)).rejects.toThrow('AI_RESPONSE_TOO_LARGE');
  });
  it('enforces actual chunked bytes even when the server omits or lies about length', async () => {
    let canceled = false;
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('x'.repeat(21)));
      },
      cancel() {
        canceled = true;
      },
    });
    await expect(
      readBoundedProviderJson(new Response(stream, { headers: { 'content-length': '2' } }), 20),
    ).rejects.toThrow('AI_RESPONSE_TOO_LARGE');
    expect(canceled).toBe(true);
  });
  it('preserves split UTF-8 and rejects truncated JSON', async () => {
    const bytes = new TextEncoder().encode('{"label":"€"}');
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        for (const byte of bytes) controller.enqueue(new Uint8Array([byte]));
        controller.close();
      },
    });
    await expect(readBoundedProviderJson(new Response(stream))).resolves.toEqual({ label: '€' });
    await expect(readBoundedProviderJson(new Response('{'))).rejects.toBeInstanceOf(SyntaxError);
  });
});

it('rejects year zero before PostgreSQL while accepting the earliest supported year', () => {
  expect(dateSchema.safeParse('0000-01-01').success).toBe(false);
  expect(dateSchema.parse('0001-01-01')).toBe('0001-01-01');
});
