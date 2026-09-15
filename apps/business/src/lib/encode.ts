import { Workload, urlCodec, encodeForUrlClient } from '@ark/core';

/**
 * The business app stores nothing either. The reasoning, and the shared
 * implementation, are in `packages/core/src/url-codec.ts`.
 *
 * A small team evaluating whether to hand a job to a model is describing, in
 * detail, how their business works. There is no reason for us to hold that.
 */
const codec = urlCodec(Workload);

export const encodeWorkload = codec.encode;
export const decodeWorkload = codec.decode;

/** Browser-safe encoder for the client intake form. */
export const encodeWorkloadClient = encodeForUrlClient;
