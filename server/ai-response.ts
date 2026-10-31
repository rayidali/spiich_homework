/** Bound bytes before parsing successful provider JSON; headers alone are not trusted. */
export async function readBoundedProviderJson(response: Response, maxBytes = 256 * 1024): Promise<unknown> {
  const advertised = response.headers.get('content-length');
  if (advertised && /^\d+$/.test(advertised) && Number(advertised) > maxBytes) {
    await response.body?.cancel().catch(() => {});
    throw new Error('AI_RESPONSE_TOO_LARGE');
  }
  const reader = response.body?.getReader();
  if (!reader) throw new SyntaxError('AI_RESPONSE_EMPTY');
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      size += next.value.byteLength;
      if (size > maxBytes) throw new Error('AI_RESPONSE_TOO_LARGE');
      chunks.push(next.value);
    }
  } catch (error) {
    await reader.cancel().catch(() => {});
    throw error;
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
}
