export async function readableStreamToString(
  stream: ReadableStream<Uint8Array>,
) {
  const r = await stream.getReader().read();

  if (!r.value) {
    return null;
  }

  return new TextDecoder().decode(r.value);
}
