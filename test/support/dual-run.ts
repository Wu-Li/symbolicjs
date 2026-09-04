import type {SolveResult} from '../../src/index.js';
import {
  compareSolveResults,
  summarizeSolveResult
} from './semantic-result.js';
import type {
  SemanticComparison,
  SemanticSolveSummary
} from './semantic-result.js';

export interface DualRunResult<Legacy, Candidate, Snapshot> {
  readonly legacy: Legacy;
  readonly candidate: Candidate;
  readonly legacySnapshot: Snapshot;
  readonly candidateSnapshot: Snapshot;
  readonly equal: boolean;
}

/** Compare an existing operation with a replacement without coupling either side. */
export function dualRunOperation<Input, Legacy, Candidate, Snapshot>(
  input: Input,
  legacyOperation: (input: Input) => Legacy,
  candidateOperation: (input: Input) => Candidate,
  legacySnapshot: (output: Legacy) => Snapshot,
  candidateSnapshot: (output: Candidate) => Snapshot
): DualRunResult<Legacy, Candidate, Snapshot> {
  const legacy = legacyOperation(input);
  const candidate = candidateOperation(input);
  const legacyValue = legacySnapshot(legacy);
  const candidateValue = candidateSnapshot(candidate);
  return Object.freeze({
    legacy,
    candidate,
    legacySnapshot: legacyValue,
    candidateSnapshot: candidateValue,
    equal: JSON.stringify(legacyValue) === JSON.stringify(candidateValue)
  });
}

export interface SolveInvocation {
  readonly equation: string;
  readonly target: string;
}

export interface DualSolveResult {
  readonly legacy: SolveResult;
  readonly candidate: SolveResult;
  readonly comparison: SemanticComparison;
  readonly legacySnapshot: SemanticSolveSummary;
  readonly candidateSnapshot: SemanticSolveSummary;
  readonly equal: boolean;
}

export function dualRunSolve(
  invocation: SolveInvocation,
  legacyOperation: (input: SolveInvocation) => SolveResult,
  candidateOperation: (input: SolveInvocation) => SolveResult
): DualSolveResult {
  const result = dualRunOperation(
    invocation,
    legacyOperation,
    candidateOperation,
    summarizeSolveResult,
    summarizeSolveResult
  );
  const comparison = compareSolveResults(result.legacy, result.candidate);
  return Object.freeze({
    legacy: result.legacy,
    candidate: result.candidate,
    comparison,
    legacySnapshot: result.legacySnapshot,
    candidateSnapshot: result.candidateSnapshot,
    equal: result.equal
  });
}
