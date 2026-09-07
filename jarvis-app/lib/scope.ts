/** Supabase's `.eq()` never matches null, so build_id-scoped queries (where
 *  null means "global") need `.is()` for the global case specifically. */
export function scopeFilter<Q extends { eq: (col: string, val: string) => Q; is: (col: string, val: null) => Q }>(
  q: Q,
  buildId: string | null,
): Q {
  return buildId === null ? q.is("build_id", null) : q.eq("build_id", buildId);
}
