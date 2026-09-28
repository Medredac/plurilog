const fs = require('fs');
const path = require('path');

const target = path.join(process.cwd(), 'src/app/api/debate/route.ts');
let source = fs.readFileSync(target, 'utf8');

function replaceOnce(oldText, newText, label) {
  if (source.includes(newText)) {
    console.log('[Preview Patch] Already applied:', label);
    return;
  }
  if (!source.includes(oldText)) {
    console.warn('[Preview Patch] Target not found:', label);
    return;
  }
  source = source.replace(oldText, newText);
  console.log('[Preview Patch] Applied:', label);
}

replaceOnce(
`            const sourceDocumentEditingForCurrentTurn =
              isDocumentCreationEnabledForSeat &&
              isDocumentRevisionFollowUp &&
              hasCurrentUserDocumentUpload &&
              !isSimplePdfFormatConversionRequest(prompt || '');`,
`            const sourceDocumentEditingForCurrentTurn =
              isDocumentCreationEnabledForSeat &&
              isDocumentRevisionFollowUp &&
              isStrongDocumentMutationRequest(prompt || '') &&
              hasCurrentUserDocumentUpload &&
              !isSimplePdfFormatConversionRequest(prompt || '');`,
  'require explicit mutation intent for current-upload source editing'
);

replaceOnce(
`                  const evidenceContinuationCanSourceEdit =
                    evidenceContinuationCanCreateFile &&
                    isDocumentRevisionFollowUp &&
                    Boolean(resolvedEditableDocumentEvidence) &&
                    (!revisionParentState ||
                      isSourcePreservingDocumentState(revisionParentState));`,
`                  const evidenceContinuationCanSourceEdit =
                    evidenceContinuationCanCreateFile &&
                    isDocumentRevisionFollowUp &&
                    isStrongDocumentMutationRequest(prompt || '') &&
                    Boolean(resolvedEditableDocumentEvidence) &&
                    (!revisionParentState ||
                      isSourcePreservingDocumentState(revisionParentState));`,
  'require explicit mutation intent for evidence source editing'
);

replaceOnce(
`                  const evidenceContinuationCanReviseFile =
                    evidenceContinuationCanCreateFile &&
                    isDocumentRevisionFollowUp &&
                    Boolean(revisionParentState) &&
                    !isSourcePreservingDocumentState(revisionParentState);`,
`                  const evidenceContinuationCanReviseFile =
                    evidenceContinuationCanCreateFile &&
                    isDocumentRevisionFollowUp &&
                    isStrongDocumentMutationRequest(prompt || '') &&
                    Boolean(revisionParentState) &&
                    !isSourcePreservingDocumentState(revisionParentState);`,
  'require explicit mutation intent for evidence file revision'
);

replaceOnce(
`              } else if (
                composedConversationGraph.semanticRows.length > 0 &&
                !composedConversationGraph.needsResolver &&
                !composedConversationGraph.executionOrder.some(
                  (operation) =>
                    operation === 'chronology' ||
                    operation === 'speaker_filter'
                )
              ) {`,
`              } else if (
                composedConversationGraph.semanticRows.length > 0 &&
                !composedConversationGraph.needsResolver &&
                composedConversationGraph.selectedRoundUserMessageIds.length > 0 &&
                composedConversationGraph.executionOrder.includes('chronology') &&
                !composedConversationGraph.executionOrder.includes('speaker_filter')
              ) {
                const selectedRoundIds = new Set(
                  composedConversationGraph.selectedRoundUserMessageIds
                );
                const selectedSemanticRows = composedConversationGraph.semanticRows
                  .filter((candidate: any) =>
                    selectedRoundIds.has(candidate?.source_user_message_id)
                  )
                  .slice(0, 3);

                if (selectedSemanticRows.length > 0) {
                  retrievedMemory = selectedSemanticRows.map((candidate: any) => ({
                    ...candidate,
                    graph_evidence: true,
                  }));
                  console.log(
                    '[Jev Memory Graph] Promoted chronology-selected round evidence',
                    {
                      selectedRoundUserMessageIds:
                        composedConversationGraph.selectedRoundUserMessageIds,
                      promotedCount: selectedSemanticRows.length,
                    }
                  );
                }
              } else if (
                composedConversationGraph.semanticRows.length > 0 &&
                !composedConversationGraph.needsResolver &&
                !composedConversationGraph.executionOrder.some(
                  (operation) =>
                    operation === 'chronology' ||
                    operation === 'speaker_filter'
                )
              ) {`,
  'promote chronology-selected semantic round evidence when no speaker filter remains'
);

fs.writeFileSync(target, source);
console.log('[Preview Patch] Composite document + conversation memory patch complete');
