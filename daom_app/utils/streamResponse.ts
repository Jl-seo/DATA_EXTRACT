export type StreamResponseChunk<T> = {
  iteratorResult: IteratorResult<T>;
  next?: Promise<StreamResponseChunk<T>>;
};

async function streamChunk<T>(generator: AsyncGenerator<T>) {
  const next = generator.next();
  return new Promise<StreamResponseChunk<T>>((resolve, reject) => {
    next.then((res) => {
      if (res.done) resolve({ iteratorResult: res });
      else resolve({ iteratorResult: res, next: streamChunk(generator) });
    });
    next.catch((error) => reject(error));
  });
}

export function streamResponse<T, P extends any[]>(
  createGenerator: (...args: P) => AsyncGenerator<T>,
) {
  return async (...args: Parameters<typeof createGenerator>) => {
    const generator = createGenerator(...args);
    return streamChunk<T>(generator);
  };
}

export function iterateStreamResponse<T>(
  streamResponse: Promise<StreamResponseChunk<T>>,
) {
  return {
    [Symbol.asyncIterator]: function () {
      return {
        current: streamResponse,
        async next() {
          const { iteratorResult, next } = await this.current;

          if (next) this.current = next;
          else iteratorResult.done = true;

          return iteratorResult;
        },
      };
    },
  };
}
