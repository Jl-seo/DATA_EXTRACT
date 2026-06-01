import { z } from 'zod';

export const ComparisonCategory = z.enum([
    'content',
    'layout',
    'style',
    'missing_element',
    'added_element',
]);

export type ComparisonCategory = z.infer<typeof ComparisonCategory>;

export const Difference = z.object({
    id: z.number(),
    description: z.string(), // Korean description
    category: z.string(), // Should be ComparisonCategory, but allowing string for flexibility with LLM
    location_1: z.tuple([z.number(), z.number(), z.number(), z.number()]).nullable(), // [ymin, xmin, ymax, xmax]
    location_2: z.tuple([z.number(), z.number(), z.number(), z.number()]).nullable(),
    page_number: z.number().default(1),
});

export type Difference = z.infer<typeof Difference>;

export const ComparisonResult = z.object({
    differences: z.array(Difference),
    error: z.string().optional(),
});

export type ComparisonResult = z.infer<typeof ComparisonResult>;
