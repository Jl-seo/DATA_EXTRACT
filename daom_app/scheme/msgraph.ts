import { z } from 'zod';

interface RawMSGraphResponse {
  '@odata.nextLink'?: string;
}

export const MSGraphResponse = z.object({
  $skipToken: z.string().optional(),
  value: z.any(),
});

export type MSGraphResponse = z.infer<typeof MSGraphResponse>;

export function parseMSGraphResponse<ItemSchema extends z.ZodTypeAny>(
  response: RawMSGraphResponse,
  itemSchema: ItemSchema,
) {
  const result = MSGraphResponse.extend({
    value: itemSchema,
  }).parse(response);

  if (response['@odata.nextLink']) {
    const url = new URL(response['@odata.nextLink']);
    result.$skipToken = url.searchParams.get('$skipToken')
      ?? url.searchParams.get('$skiptoken')
      ?? undefined;
  }

  return result;
}
