export type CurrentRequestDomain =
  | 'document'
  | 'visual'
  | 'conversation';

export type CurrentRequestReferenceRole =
  | 'target'
  | 'source'
  | 'output'
  | 'evidence';

export type CurrentRequestAction =
  | 'mutate'
  | 'inspect'
  | 'create'
  | 'convert'
  | 'reference'
  | 'unknown';

export type CurrentRequestArtifactKind =
  | 'pdf'
  | 'docx'
  | 'generic_document'
  | 'image'
  | 'unknown';

export type CurrentRequestVersionRelation =
  | 'root'
  | 'latest'
  | 'previous'
  | 'ordinal'
  | 'exact'
  | null;

export type CurrentRequestCreator =
  | 'chatgpt'
  | 'claude'
  | 'gemini'
  | null;

export interface CurrentRequestEvidenceSpan {
  text: string;
  start: number;
  end: number;
}

export interface CurrentRequestReference {
  id: string;
  domain: CurrentRequestDomain;
  role: CurrentRequestReferenceRole;
  action: CurrentRequestAction;
  artifactKind: CurrentRequestArtifactKind;
  provenance: {
    owner: 'user' | 'assistant' | null;
    creator: CurrentRequestCreator;
  };
  version: {
    relation: CurrentRequestVersionRelation;
    ordinal: number | null;
  };
  filename: string | null;
  evidence: CurrentRequestEvidenceSpan;
}

export interface CurrentRequestFacts {
  version: 1;
  references: CurrentRequestReference[];
  preservation: {
    preserveUnmentioned: boolean;
  };
}

const DOCUMENT_NOUN =
  /\b(?:pdf|docx|word(?:\s+document)?|document|file|resume|résumé|cv|rirekisho)\b/gi;
const VISUAL_NOUN =
  /\b(?:image|photo|picture|screenshot|illustration|graphic)\b/gi;

const MUTATION_VERB =
  /\b(?:redo|revise|rework|reformat|restyle|redesign|edit|modify|update|fix|adjust|change|rebuild|add|insert|restore|include|put|place|embed|attach|move|resize|shrink|enlarge|reduce|increase|decrease|rename|replace|remove|delete|align|centre|center|bold|italic(?:ize)?|recolor|recolour)\b/i;
const CREATION_VERB =
  /\b(?:create|make|generate|draft|produce|build|write)\b/i;
const INSPECTION_VERB =
  /\b(?:read|inspect|review|summari[sz]e|compare|check|analyse|analyze|explain|extract|show|quote)\b/i;
const CONVERSION_VERB =
  /\b(?:convert|export|turn|transform)\b/i;

const ROOT_CUE = /\b(?:original|earliest|first)\b/i;
const LATEST_CUE = /\b(?:latest|newest|most\s+recent)\b/i;
const PREVIOUS_CUE = /\b(?:previous|prior|earlier)\b/i;
const USER_PROVENANCE_CUE =
  /\b(?:i\s+(?:uploaded|attached|sent|gave)|my\s+(?:upload|uploaded|attachment|attached)|user[-\s]uploaded|uploaded\s+by\s+me|attached\s+by\s+me)\b/i;
const ASSISTANT_PROVENANCE_CUE =
  /\b(?:you\s+(?:made|created|generated|edited|revised)|assistant[-\s](?:made|created|generated|edited|revised))\b/i;

const PRESERVE_UNMENTIONED =
  /\b(?:don['’]?t\s+change\s+anything\s+else|do\s+not\s+change\s+anything\s+else|keep\s+everything\s+else(?:\s+the\s+same)?|leave\s+everything\s+else(?:\s+alone|unchanged)?|preserve\s+(?:everything|the\s+rest)|only\s+change)\b/i;

function artifactKindFor(text: string): CurrentRequestArtifactKind {
  const value = text.toLowerCase();
  if (value === 'pdf') return 'pdf';
  if (value === 'docx' || value.startsWith('word')) return 'docx';
  if (
    ['image', 'photo', 'picture', 'screenshot', 'illustration', 'graphic'].includes(
      value
    )
  ) {
    return 'image';
  }
  return 'generic_document';
}

function ordinalFromContext(value: string): number | null {
  const word = value.match(
    /\b(first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth)\b/i
  )?.[1]?.toLowerCase();

  if (word) {
    const ordinals: Record<string, number> = {
      first: 1,
      second: 2,
      third: 3,
      fourth: 4,
      fifth: 5,
      sixth: 6,
      seventh: 7,
      eighth: 8,
      ninth: 9,
      tenth: 10,
    };
    return ordinals[word] || null;
  }

  const numeric = value.match(/\b(\d{1,2})(?:st|nd|rd|th)\b/i)?.[1];
  return numeric ? Number.parseInt(numeric, 10) : null;
}

function creatorFromContext(value: string): CurrentRequestCreator {
  if (/\b(?:chatgpt|gpt|openai)\b/i.test(value)) return 'chatgpt';
  if (/\b(?:claude|anthropic)\b/i.test(value)) return 'claude';
  if (/\b(?:gemini|google)\b/i.test(value)) return 'gemini';
  return null;
}

function actionForPrompt(
  prompt: string,
  domain: CurrentRequestDomain
): CurrentRequestAction {
  if (domain === 'conversation') return 'reference';

  if (CONVERSION_VERB.test(prompt)) return 'convert';
  if (MUTATION_VERB.test(prompt)) return 'mutate';
  if (CREATION_VERB.test(prompt)) return 'create';
  if (INSPECTION_VERB.test(prompt)) return 'inspect';
  return 'reference';
}

function roleForAction(
  action: CurrentRequestAction
): CurrentRequestReferenceRole {
  if (action === 'create') return 'output';
  if (action === 'inspect') return 'evidence';
  return 'target';
}

function contextWindow(
  prompt: string,
  start: number,
  end: number,
  radius = 72
): string {
  return prompt.slice(Math.max(0, start - radius), Math.min(prompt.length, end + radius));
}

function versionFromContext(value: string): {
  relation: CurrentRequestVersionRelation;
  ordinal: number | null;
} {
  const ordinal = ordinalFromContext(value);
  if (ordinal && ordinal > 1) {
    return { relation: 'ordinal', ordinal };
  }
  if (LATEST_CUE.test(value)) return { relation: 'latest', ordinal: null };
  if (PREVIOUS_CUE.test(value)) return { relation: 'previous', ordinal: null };
  if (ROOT_CUE.test(value)) return { relation: 'root', ordinal: null };
  return { relation: null, ordinal: null };
}

function provenanceFromContext(value: string): {
  owner: 'user' | 'assistant' | null;
  creator: CurrentRequestCreator;
} {
  const creator = creatorFromContext(value);
  if (USER_PROVENANCE_CUE.test(value)) {
    return { owner: 'user', creator };
  }
  if (ASSISTANT_PROVENANCE_CUE.test(value) || creator) {
    return { owner: 'assistant', creator };
  }
  return { owner: null, creator: null };
}

function filenameFromContext(value: string): string | null {
  const filename = value.match(
    /(?:["'“”‘’]([^"'“”‘’]+\.(?:pdf|docx))["'“”‘’]|\b([A-Za-z0-9][^\n\r]{0,80}?\.(?:pdf|docx))\b)/i
  );
  return (filename?.[1] || filename?.[2] || '').trim() || null;
}

function collectArtifactReferences(
  prompt: string,
  domain: 'document' | 'visual',
  pattern: RegExp,
  nextId: () => string
): CurrentRequestReference[] {
  const references: CurrentRequestReference[] = [];
  pattern.lastIndex = 0;

  let match: RegExpExecArray | null;
  while ((match = pattern.exec(prompt)) !== null) {
    const text = match[0];
    const start = match.index;
    const end = start + text.length;
    const context = contextWindow(prompt, start, end);
    const action = actionForPrompt(prompt, domain);

    references.push({
      id: nextId(),
      domain,
      role: roleForAction(action),
      action,
      artifactKind: artifactKindFor(text),
      provenance: provenanceFromContext(context),
      version: versionFromContext(context),
      filename: domain === 'document' ? filenameFromContext(context) : null,
      evidence: {
        text,
        start,
        end,
      },
    });
  }

  return references;
}

export function parseCurrentRequestFacts(promptValue: string): CurrentRequestFacts {
  const prompt = promptValue || '';
  let sequence = 0;
  const nextId = () => `ref_${++sequence}`;

  const references = [
    ...collectArtifactReferences(prompt, 'document', DOCUMENT_NOUN, nextId),
    ...collectArtifactReferences(prompt, 'visual', VISUAL_NOUN, nextId),
  ].sort((a, b) => a.evidence.start - b.evidence.start);

  return {
    version: 1,
    references,
    preservation: {
      preserveUnmentioned: PRESERVE_UNMENTIONED.test(prompt),
    },
  };
}
