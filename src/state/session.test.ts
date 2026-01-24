import { describe, it, expect } from 'vitest';
import { MemoryStorageAdapter } from './storage.js';
import { SessionManager } from './session.js';

describe('SessionManager', () => {
  describe('findResumePoint', () => {
    it('returns round 1 codex_review for fresh session', async () => {
      const storage = new MemoryStorageAdapter('/input.md');
      const session = new SessionManager(storage, '/input.md', '/output.md', 5);
      await session.initialize();
      const { round, phase } = await session.findResumePoint();
      expect(round).toBe(1);
      expect(phase).toBe('codex_review');
    });

    it('returns claude_response if codex review exists', async () => {
      const storage = new MemoryStorageAdapter('/input.md');
      const session = new SessionManager(storage, '/input.md', '/output.md', 5);
      await session.initialize();
      await session.saveCodexReview(1, {
        issues: [],
        opportunities: [],
        overall_assessment: 'Good',
      });
      const { round, phase } = await session.findResumePoint();
      expect(round).toBe(1);
      expect(phase).toBe('claude_response');
    });

    it('returns consensus_check if claude response exists', async () => {
      const storage = new MemoryStorageAdapter('/input.md');
      const session = new SessionManager(storage, '/input.md', '/output.md', 5);
      await session.initialize();
      await session.saveCodexReview(1, {
        issues: [],
        opportunities: [],
        overall_assessment: 'Good',
      });
      await session.saveClaudeResponse(1, {
        responses: [],
        updated_document: 'Updated',
        consensus_assessment: {
          reached: false,
          outstanding_disagreements: [],
          confidence: 0.5,
          summary: 'Test',
        },
      });
      const { round, phase } = await session.findResumePoint();
      expect(round).toBe(1);
      expect(phase).toBe('consensus_check');
    });

    it('returns next round if document saved', async () => {
      const storage = new MemoryStorageAdapter('/input.md');
      const session = new SessionManager(storage, '/input.md', '/output.md', 5);
      await session.initialize();
      await session.saveCodexReview(1, {
        issues: [],
        opportunities: [],
        overall_assessment: 'Good',
      });
      await session.saveClaudeResponse(1, {
        responses: [],
        updated_document: 'Updated',
        consensus_assessment: {
          reached: false,
          outstanding_disagreements: [],
          confidence: 0.5,
          summary: 'Test',
        },
      });
      await session.saveDocument(1, 'Final round 1 doc');
      const { round, phase } = await session.findResumePoint();
      expect(round).toBe(2);
      expect(phase).toBe('pending');
    });
  });

  describe('manifest management', () => {
    it('creates initial manifest with correct values', async () => {
      const storage = new MemoryStorageAdapter('/input.md', 'test-session');
      const session = new SessionManager(storage, '/input.md', '/output.md', 3);
      await session.initialize();

      const manifest = session.getManifest();
      expect(manifest.session_id).toBe('test-session');
      expect(manifest.input_file).toBe('/input.md');
      expect(manifest.output_file).toBe('/output.md');
      expect(manifest.max_rounds).toBe(3);
      expect(manifest.status).toBe('in_progress');
      expect(manifest.current_round).toBe(1);
      expect(manifest.current_phase).toBe('pending');
    });

    it('updates phase correctly', async () => {
      const storage = new MemoryStorageAdapter('/input.md');
      const session = new SessionManager(storage, '/input.md', '/output.md', 5);
      await session.initialize();

      await session.setPhase('codex_review');
      expect(session.getCurrentPhase()).toBe('codex_review');

      await session.setPhase('claude_response');
      expect(session.getCurrentPhase()).toBe('claude_response');
    });

    it('completes session with correct status', async () => {
      const storage = new MemoryStorageAdapter('/input.md');
      const session = new SessionManager(storage, '/input.md', '/output.md', 5);
      await session.initialize();

      await session.complete('completed');
      const manifest = session.getManifest();
      expect(manifest.status).toBe('completed');
      expect(manifest.completed_at).not.toBeNull();
    });
  });

  describe('artifact persistence', () => {
    it('saves and loads codex review', async () => {
      const storage = new MemoryStorageAdapter('/input.md');
      const session = new SessionManager(storage, '/input.md', '/output.md', 5);
      await session.initialize();

      const review = {
        issues: [{ id: 'issue-1', severity: 'critical' as const, section: 'Intro', description: 'Test' }],
        opportunities: [],
        overall_assessment: 'Needs work',
      };

      await session.saveCodexReview(1, review);
      const loaded = await session.loadCodexReview(1);

      expect(loaded).toEqual(review);
    });

    it('saves and loads claude response', async () => {
      const storage = new MemoryStorageAdapter('/input.md');
      const session = new SessionManager(storage, '/input.md', '/output.md', 5);
      await session.initialize();

      const response = {
        responses: [{ feedback_id: 'issue-1', verdict: 'agree' as const, reasoning: 'Good point', action_taken: 'Fixed' }],
        updated_document: 'Updated content',
        consensus_assessment: {
          reached: true,
          outstanding_disagreements: [],
          confidence: 0.9,
          summary: 'All good',
        },
      };

      await session.saveClaudeResponse(1, response);
      const loaded = await session.loadClaudeResponse(1);

      expect(loaded).toEqual(response);
    });
  });
});
