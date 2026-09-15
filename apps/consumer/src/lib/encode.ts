import { ConsumerIntake, urlCodec, encodeForUrlClient } from '@ark/core';

/**
 * Results are encoded into the URL rather than stored. The reasoning, and the
 * shared implementation, are in `packages/core/src/url-codec.ts`.
 */
const codec = urlCodec(ConsumerIntake);

export const encodeIntake = codec.encode;
export const decodeIntake = codec.decode;

/** Browser-safe encoder for the client wizard. */
export const encodeIntakeClient = encodeForUrlClient;
