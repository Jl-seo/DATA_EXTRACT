import { z } from 'zod';

const FacingModeSchema = z.enum(['environment', 'user']);
export type FacingMode = z.infer<typeof FacingModeSchema>;

export const buildCameraConstraintsCandidates = (
    preferred: FacingMode = 'environment'
): MediaTrackConstraints[] => {
    const parsedPreferred = FacingModeSchema.parse(preferred);
    const fallback: FacingMode = parsedPreferred === 'environment' ? 'user' : 'environment';

    return [
        { facingMode: parsedPreferred },
        { facingMode: fallback },
    ];
};
