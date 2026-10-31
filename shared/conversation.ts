import { z } from 'zod';

export const MAX_CONVERSATION_MESSAGES = 100;
export const MAX_MESSAGE_CHARACTERS = 4000;
// Retain the former 12 × 4,000 character maximum while allowing more short
// follow-ups. Never satisfy this budget by removing earlier user instructions.
export const MAX_CONVERSATION_CHARACTERS = 48000;
// Leave room inside Express's 128 KiB request limit for the request envelope.
export const MAX_CONVERSATION_BYTES = 112 * 1024;

export type ConversationMessage = { role: 'user' | 'assistant'; content: string };

/** Pure, shared UI/API admission check. It neither edits nor summarizes text. */
export function conversationBudgetError(messages: readonly ConversationMessage[]): string | undefined {
  if (messages.some((message) => message.content.length > MAX_MESSAGE_CHARACTERS))
    return 'A message is too long. Keep each message within 4,000 characters.';
  if (
    messages.length > MAX_CONVERSATION_MESSAGES ||
    messages.reduce((total, message) => total + message.content.length, 0) > MAX_CONVERSATION_CHARACTERS ||
    new TextEncoder().encode(JSON.stringify({ messages })).byteLength > MAX_CONVERSATION_BYTES
  )
    return 'This conversation is full. Start a new conversation and include the accounts, dates and amounts again. Your existing conversation has not been discarded.';
  return undefined;
}

export const conversationSchema = z
  .array(
    z.strictObject({
      role: z.enum(['user', 'assistant']),
      content: z
        .string()
        .min(1)
        .max(MAX_MESSAGE_CHARACTERS)
        .refine((content) => content.trim().length > 0, 'A message cannot be blank.'),
    }),
  )
  .min(1)
  .max(MAX_CONVERSATION_MESSAGES)
  .superRefine((messages, context) => {
    const error = conversationBudgetError(messages);
    if (error) context.addIssue({ code: 'custom', message: error });
  });

export const messagesSchema = conversationSchema.refine(
  (messages) => messages.at(-1)?.role === 'user',
  'The conversation must end with your question.',
);
