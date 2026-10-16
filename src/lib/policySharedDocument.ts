/** Optional shared envelope. CPL remains the complete, authoritative editable content. */
export const SHARED_POLICY_FORMAT = 'proxytools-policy';
export function encodeSharedPolicy(cpl: string) {
  return (
    JSON.stringify(
      { format: SHARED_POLICY_FORMAT, version: 1, cpl },
      null,
      2,
    ) + '\n'
  );
}
export function decodeSharedPolicy(text: string): string {
  const doc = JSON.parse(text.replace(/^\uFEFF/, ''));
  if (
    doc?.format !== SHARED_POLICY_FORMAT ||
    doc.version !== 1 ||
    typeof doc.cpl !== 'string'
  )
    throw new Error(
      'Unsupported shared policy document. Expected proxytools-policy version 1.',
    );
  return doc.cpl;
}
