import type { Round } from './discussionMemory';

export interface ConversationSourceAnchor {
  source_user_message_id: string;
  query: string;
}

/** Select complementary verbatim passages instead of the first repeated name. */
export function relevantConversationExcerpt(text: string, query: string, maxChars: number): string {
  const clean = String(text || '').trim();
  if (clean.length <= maxChars) return clean;
  if (maxChars < 80) return clean.slice(0, Math.max(0, maxChars));
  const stop = new Set(['about', 'after', 'again', 'before', 'could', 'earlier', 'from', 'have',
    'history', 'memory', 'please', 'previous', 'said', 'that', 'their', 'there', 'these',
    'they', 'this', 'those', 'what', 'when', 'where', 'which', 'with', 'would', 'your']);
  const tokens = [...new Set((query.toLowerCase().match(/[\p{L}\p{N}]+/gu) || [])
    .filter(token => token.length >= 3 && !stop.has(token)))].slice(0, 24);
  const lower = clean.toLowerCase();
  const hits = tokens.map(token => {
    const positions: number[] = [];
    for (let pos = lower.indexOf(token); pos >= 0 && positions.length < 128;
      pos = lower.indexOf(token, pos + token.length)) positions.push(pos);
    return positions;
  });
  if (!hits.some(positions => positions.length)) return `${clean.slice(0, maxChars - 1).trimEnd()}…`;

  // Reserve room for omission markers; at most three disjoint passages.
  const width = Math.floor((maxChars - 24) / 3);
  const starts = new Set<number>([0]);
  for (const positions of hits) for (const pos of positions) {
    starts.add(Math.max(0, Math.min(clean.length - width, pos - Math.floor(width / 3))));
  }
  const ranges: Array<[number, number]> = [];
  const covered = new Set<number>();
  for (let pass = 0; pass < 3; pass++) {
    let best: { start: number; score: number; matched: number[] } | null = null;
    for (const start of starts) {
      if (ranges.some(([a, b]) => start < b && start + width > a)) continue;
      const matched = hits.flatMap((positions, index) => positions.some(pos => pos >= start && pos < start + width) ? [index] : []);
      const score = matched.reduce((sum, index) => sum + (covered.has(index) ? 0.05 : 1) / Math.sqrt(hits[index].length), 0);
      if (score > 0 && (!best || score > best.score)) best = { start, score, matched };
    }
    if (!best) break;
    ranges.push([best.start, best.start + width]);
    best.matched.forEach(index => covered.add(index));
  }
  ranges.sort((a, b) => a[0] - b[0]);
  return ranges.map(([start, end]) => `${start > 0 ? '…' : ''}${clean.slice(start, end).trim()}${end < clean.length ? '…' : ''}`).join('\n[…]\n');
}

/** References are valid only when they resolve to user text in this discussion. */
export function validateConversationSourceAnchors(raw: unknown, rounds?: Round[]): ConversationSourceAnchor[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const anchors: ConversationSourceAnchor[] = [];
  for (const value of raw) {
    if (!value || typeof value.source_user_message_id !== 'string' || typeof value.query !== 'string') continue;
    const id = value.source_user_message_id.trim();
    const query = value.query.replace(/\s+/g, ' ').trim().slice(0, 190);
    if (!id || !query || seen.has(id)) continue;
    if (rounds && !rounds.some(round => round.userMessageId === id && round.userPrompt?.trim() && !/^continue[.!?\s]*$/i.test(round.userPrompt.trim()))) continue;
    seen.add(id);
    anchors.push({ source_user_message_id: id, query });
    if (anchors.length === 2) break;
  }
  return anchors;
}
