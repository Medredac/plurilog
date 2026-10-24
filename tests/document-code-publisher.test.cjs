require('./helpers/register-typescript.cjs');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');
const calls = []; let failStorage = false;
const mock = {
  './generatedDocumentStorage': { persistGeneratedDocument: async input => {
    calls.push(['storage', input]); if (failStorage) throw Error('Storage failed');
    return { filename: input.filename, storagePath: 'owner/file.pdf', signedUrl: 'signed', durableUrl: 'durable' };
  } },
  './docxRenderedPages': { persistDocxRenderedPages: async () => [] },
  './pdfRenderedPages': { persistPdfRenderedPages: async input => { calls.push(['pages', input]); return [{ signedUrl: 'page', filename: 'page.png' }]; } },
  './discussionMemory': { ingestParsedDocument: async input => { calls.push(['index', input]); }, ingestDiscussionArtifacts: async () => {} },
  './documentRevisionState': { findDocumentStateSnapshot: async () => ({ id: 'parent-state', documentId: 'parent-doc' }), persistDocumentStateSnapshot: async input => { calls.push(['state', input]); return { id: 'new-state' }; } },
  './docxParser': { parseDocx: async () => ({ embeddedImages: [] }) },
  './docxVisualAssets': { persistDocxEmbeddedImages: async () => [] },
  './pdfEmbeddedImages': { extractPdfEmbeddedImages: async () => { throw Error('Should not launch another sandbox for a PDF with no images'); }, persistPdfEmbeddedImages: async () => [] },
};
const original = Module._load;
Module._load = function(name, ...rest) { return mock[name] || original.call(this, name, ...rest); };
const { publishCodeDocument } = require('../src/utils/documentCodePublisher.ts');
Module._load = original;
const supabase = { from: name => { assert.equal(name, 'messages'); return { upsert: async (row, options) => { calls.push(['message', row, options]); return { error: null }; } }; } };
const query = { select() { return this; }, eq() { return this; }, async maybeSingle() { return { data: { id: 'indexed-doc' } }; } };
const service = { from: name => { assert.equal(name, 'discussion_documents'); return query; } };
const options = () => ({ supabase, service, openai: {}, discussionId: 'discussion', messageId: 'message', seatId: 'chatgpt', signal: new AbortController().signal,
  draft: { args: { filename: 'brief.pdf', format: 'pdf', code: 'complete code', requirements: ['Requirement'], inputs: ['source.pdf'] }, buffer: Buffer.from('%PDF'), fullText: 'Full retained document text', report: { image_count: 0 }, pages: [{ pageNumber: 1, data: Buffer.from('image'), contentType: 'image/png' }] },
  sources: [{ filename: 'source.pdf', storagePath: 'owner/source.pdf' }], review: ['review'], limitations: [],
});
test('publishes through existing attachment, retrieval and revision contracts', async () => {
  const result = await publishCodeDocument(options());
  assert.equal(result.durableUrl, 'durable'); assert.equal(result.documentStateId, 'new-state');
  assert.equal(result.visualReviewCostUsd, 0); assert.equal(result.fullText, 'Full retained document text');
  assert.equal(calls.find(x => x[0] === 'storage')[1].supabase, supabase);
  assert.equal(calls.find(x => x[0] === 'index')[1].storagePath, 'owner/file.pdf');
  const state = calls.find(x => x[0] === 'state')[1];
  assert.equal(state.parentStoragePath, 'owner/source.pdf'); assert.equal(state.spec.engine, 'document-code-v1'); assert.equal(state.spec.code, 'complete code');
});
test('storage failure cannot be returned as a delivered document', async () => {
  failStorage = true;
  await assert.rejects(publishCodeDocument(options()), /Storage failed/);
});
