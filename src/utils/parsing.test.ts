import { describe, it, expect } from 'vitest';
import { parseCliOutput, extractCodexAssistantMessage } from './parsing.js';
import { CodexReviewSchema } from '../types/index.js';

describe('parseCliOutput', () => {
  it('extracts JSON from sentinel markers', () => {
    const input = `Some preamble
<<<QUIBBLE_JSON_START>>>
{"issues": [], "opportunities": [], "overall_assessment": "Good"}
<<<QUIBBLE_JSON_END>>>
trailing`;

    const result = parseCliOutput(input, CodexReviewSchema);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.issues).toEqual([]);
      expect(result.data.overall_assessment).toBe('Good');
    }
  });

  it('extracts JSON from code fences when no sentinels', () => {
    const input = 'Review:\n\n```json\n{"issues": [], "opportunities": [], "overall_assessment": "Good"}\n```\n\nDone.';
    const result = parseCliOutput(input, CodexReviewSchema);
    expect(result.success).toBe(true);
  });

  it('extracts JSON by brace matching as fallback', () => {
    const input = 'The review is: {"issues": [], "opportunities": [], "overall_assessment": "Good"} end.';
    const result = parseCliOutput(input, CodexReviewSchema);
    expect(result.success).toBe(true);
  });

  it('returns error for invalid JSON', () => {
    const result = parseCliOutput('No JSON here', CodexReviewSchema);
    expect(result.success).toBe(false);
  });

  it('returns error for schema validation failure', () => {
    const input = '<<<QUIBBLE_JSON_START>>>{"wrong": "schema"}<<<QUIBBLE_JSON_END>>>';
    const result = parseCliOutput(input, CodexReviewSchema);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toContain('Schema validation failed');
  });
});

describe('extractCodexAssistantMessage', () => {
  it('extracts last assistant message from JSONL', () => {
    const input = '{"type":"system","content":"init"}\n{"type":"assistant_message","content":"First"}\n{"type":"assistant_message","content":"Final"}';
    expect(extractCodexAssistantMessage(input)).toBe('Final');
  });

  it('returns null for no assistant messages', () => {
    const input = '{"type":"system","content":"init"}\n{"type":"tool_call","name":"search"}';
    expect(extractCodexAssistantMessage(input)).toBeNull();
  });
});
