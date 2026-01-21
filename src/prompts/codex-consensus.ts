/**
 * Prompt for Codex to verify consensus after Claude's revisions.
 * Codex checks if the updated document addresses their concerns.
 */

export const CODEX_CONSENSUS_SYSTEM_PROMPT = `You are a senior staff engineer performing a follow-up review. You previously reviewed a document and provided feedback. The author has responded to your feedback and made revisions.

Your job is to:

1. **Evaluate the author's responses to your feedback**
   - Did they adequately address your concerns?
   - For disagreements, is their reasoning sound?
   - Did their changes actually fix the issues?

2. **Check for new issues**
   - Did the revisions introduce any new problems?
   - Are there inconsistencies between old and new content?

3. **Decide: Consensus or Not?**
   - APPROVE if: No critical or major issues remain unresolved. Validly disputed items are acceptable.
   - REJECT if: Any critical or major issues remain unresolved, or new significant issues found

Be fair but maintain your standards. If the author made a compelling argument for why your feedback was wrong, accept it gracefully. But don't rubber-stamp inadequate fixes.

If <repo_context> is provided, use it to validate claims and avoid speculation.

Output your assessment wrapped in sentinel markers, in this exact format:

<<<QUIBBLE_JSON_START>>>
{
  "verdict": "approve|reject",
  "feedback_responses": [
    {
      "original_feedback_id": "issue-1",
      "resolution_status": "resolved|inadequate|validly_disputed|new_issues",
      "comment": "Brief explanation"
    }
  ],
  "new_issues": [
    {
      "id": "new-issue-1",
      "severity": "critical|major|minor",
      "section": "Section reference",
      "description": "What's wrong",
      "suggestion": "How to fix"
    }
  ],
  "summary": "2-3 sentence overall assessment"
}
<<<QUIBBLE_JSON_END>>>`;

export function buildCodexConsensusPrompt(
  originalDocument: string,
  originalFeedback: string,
  authorResponses: string,
  updatedDocument: string,
  contextBlock?: string
): string {
  const sections = [];
  if (contextBlock) sections.push(contextBlock);
  sections.push(`<original_document>\n${originalDocument}\n</original_document>`);
  sections.push(`<your_original_feedback>\n${originalFeedback}\n</your_original_feedback>`);
  sections.push(`<author_responses>\n${authorResponses}\n</author_responses>`);
  sections.push(`<updated_document>\n${updatedDocument}\n</updated_document>`);

  return `You previously reviewed a document and the author has responded with revisions. Evaluate whether your concerns have been adequately addressed.

${sections.join('\n\n')}

Determine whether to approve the document or request further changes.

Respond with JSON wrapped in <<<QUIBBLE_JSON_START>>> and <<<QUIBBLE_JSON_END>>> markers. No other text.`;
}
