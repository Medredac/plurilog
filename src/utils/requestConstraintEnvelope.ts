import type {
  CurrentRequestFacts,
  CurrentRequestReference,
} from '@/utils/currentRequestFacts';

export type LegacyDocumentReferenceRole =
  | 'user_uploaded'
  | 'generated_or_revised'
  | 'latest'
  | null;

export interface RequestConstraintEnvelope {
  facts: CurrentRequestFacts;
  mandatoryOperations: string[];
  continuation: {
    documentRevision: boolean;
  };
  lockedConstraints: {
    documentSelector: {
      artifactKind: CurrentRequestReference['artifactKind'];
      owner: CurrentRequestReference['provenance']['owner'];
      creator: CurrentRequestReference['provenance']['creator'];
      versionRelation: CurrentRequestReference['version']['relation'];
      ordinal: number | null;
      filename: string | null;
      evidenceText: string;
    } | null;
  };
  preservation: {
    preserveUnmentioned: boolean;
  };
  legacyExecution: {
    documentReferenceRole: LegacyDocumentReferenceRole;
  };
}

function selectExplicitDocumentMutation(
  facts: CurrentRequestFacts
): CurrentRequestReference | null {
  return (
    facts.references.find(
      (reference) =>
        reference.domain === 'document' &&
        reference.action === 'mutate' &&
        reference.role === 'target'
    ) || null
  );
}

function legacyDocumentRoleFor(
  reference: CurrentRequestReference | null
): LegacyDocumentReferenceRole {
  if (!reference) return null;

  if (reference.provenance.owner === 'user') {
    return 'user_uploaded';
  }

  if (reference.version.relation === 'latest') {
    return 'latest';
  }

  if (
    reference.provenance.owner === 'assistant' ||
    reference.provenance.creator === 'chatgpt'
  ) {
    return 'generated_or_revised';
  }

  // Compatibility bridge only. The facts layer intentionally stores
  // "original" as a lineage relation (root), not as ownership. The current
  // document executor does not yet expose a root selector, while the existing
  // preview behaviour maps "original document" to the user-uploaded source.
  // Preserve that working behaviour until provenance-native root selection is
  // introduced and regression-tested.
  if (reference.version.relation === 'root') {
    return 'user_uploaded';
  }

  return null;
}

export function buildRequestConstraintEnvelope(
  facts: CurrentRequestFacts,
  options?: { documentRevisionContinuation?: boolean }
): RequestConstraintEnvelope {
  const documentMutation = selectExplicitDocumentMutation(facts);
  const documentRevisionContinuation =
    options?.documentRevisionContinuation === true;

  return {
    facts,
    mandatoryOperations:
      documentMutation || documentRevisionContinuation
        ? ['document_search']
        : [],
    continuation: {
      documentRevision: documentRevisionContinuation,
    },
    lockedConstraints: {
      documentSelector: documentMutation
        ? {
            artifactKind: documentMutation.artifactKind,
            owner: documentMutation.provenance.owner,
            creator: documentMutation.provenance.creator,
            versionRelation: documentMutation.version.relation,
            ordinal: documentMutation.version.ordinal,
            filename: documentMutation.filename,
            evidenceText: documentMutation.evidence.text,
          }
        : null,
    },
    preservation: {
      preserveUnmentioned: facts.preservation.preserveUnmentioned,
    },
    legacyExecution: {
      documentReferenceRole:
        legacyDocumentRoleFor(documentMutation) ||
        (documentRevisionContinuation ? 'generated_or_revised' : null),
    },
  };
}
