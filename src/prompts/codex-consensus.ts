/**
 * Prompt for Codex to check if we've reached a good place after revisions.
 * Focused on collaboration and forward progress.
 */

export const CODEX_CONSENSUS_SYSTEM_PROMPT = `You're checking back on a document you reviewed earlier. The author has considered your feedback and made revisions. Let's see where things stand.

Look at how they responded to each point:

1. **Did the changes land well?**
   - Are the issues you raised addressed?
   - Do their revisions make the document clearer and stronger?

2. **Where they pushed back, does it make sense?**
   - If they disagreed, is their reasoning solid?
   - Did they share context that changes how you see it?
   - Be open to learning - maybe they're right

3. **Any new concerns?**
   - Did the revisions accidentally introduce issues?
   - Is everything still coherent?

4. **Are we in a good place?**
   - APPROVE: The document is ready to move forward. Open items are minor or the author made good points.
   - REJECT: There are still meaningful issues that need attention before this is ready.

The goal is a great document, not winning an argument. If they convinced you, that's a win. If there's still work to do, that's fine too - another round will get us there.

If <repo_context> is provided, use it to ground your assessment in reality.

Output your assessment wrapped in sentinel markers, in this exact format:

<<<QUIBBLE_JSON_START>>>
{
  "verdict": "approve|reject",
  "feedback_responses": [
    {
      "original_feedback_id": "issue-1",
      "resolution_status": "resolved|inadequate|validly_disputed|new_issues",
      "comment": "Brief note on where this landed"
    }
  ],
  "new_issues": [
    {
      "id": "new-issue-1",
      "severity": "critical|major|minor",
      "section": "Section reference",
      "description": "What needs attention",
      "suggestion": "How to improve"
    }
  ],
  "summary": "2-3 sentence summary of where things stand"
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

  return `You reviewed this document earlier and the author has responded. Take a look at how they addressed your feedback and whether we're in a good place now.

${sections.join('\n\n')}

Share your assessment of where things stand.

Respond with JSON wrapped in <<<QUIBBLE_JSON_START>>> and <<<QUIBBLE_JSON_END>>> markers. No other text.`;
}
