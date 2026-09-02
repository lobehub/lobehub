/**
 * VectorPaddingService - Handles vector dimension padding/truncation
 * for universal embedding support in LobeHub.
 *
 * This service ensures that embedding vectors from any model
 * are padded/truncated to the target dimension (default: 1024)
 * before storage in the database.
 *
 * Mathematical property: zero-padding preserves cosine similarity exactly.
 * cos(A_padded, B_padded) = cos(A, B) for any vectors A, B.
 */

/**
 * Pad or truncate a vector to the target dimension.
 *
 * - If vector is smaller than target: pad with zeros (no information loss for cosine similarity)
 * - If vector matches target: return as-is (zero allocation)
 * - If vector is larger than target: truncate (lossy, but necessary for larger dimensions)
 *
 * @param vector - The input vector (null/undefined treated as empty)
 * @param targetDim - The target dimension (must be positive)
 * @returns A new vector of exactly targetDim length
 * @throws Error if targetDim is not positive
 */
export function padVector(vector: number[] | null | undefined, targetDim: number): number[] {
  if (targetDim <= 0) {
    throw new Error(`Target dimension must be positive, got ${targetDim}`);
  }

  // Handle null/undefined as empty vector
  if (!vector || vector.length === 0) {
    return Array.from({ length: targetDim }, () => 0);
  }

  // Fast path: already correct dimension
  if (vector.length === targetDim) {
    return vector;
  }

  // Truncate if larger
  if (vector.length > targetDim) {
    return vector.slice(0, targetDim);
  }

  // Pad with zeros
  return [...vector, ...Array.from({ length: targetDim - vector.length }, () => 0)];
}

/**
 * Validate that a vector has the expected dimension.
 *
 * @param vector - The input vector
 * @param expectedDim - The expected dimension
 * @returns Validation result with actual and expected dimensions
 */
export function validateVectorDimension(
  vector: number[],
  expectedDim: number,
): { actual: number; expected: number; valid: boolean } {
  return {
    actual: vector.length,
    expected: expectedDim,
    valid: vector.length === expectedDim,
  };
}
