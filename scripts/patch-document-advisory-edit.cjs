const fs = require('fs');
const path = require('path');

const target = path.join(process.cwd(), 'src/app/api/debate/route.ts');
let source = fs.readFileSync(target, 'utf8');

const oldGate = `            const sourceDocumentEditingForCurrentTurn =
              isDocumentCreationEnabledForSeat &&
              isDocumentRevisionFollowUp &&
              hasCurrentUserDocumentUpload &&
              !isSimplePdfFormatConversionRequest(prompt || '');`;

const newGate = `            const sourceDocumentEditingForCurrentTurn =
              isDocumentCreationEnabledForSeat &&
              isDocumentRevisionFollowUp &&
              isStrongDocumentMutationRequest(prompt || '') &&
              hasCurrentUserDocumentUpload &&
              !isSimplePdfFormatConversionRequest(prompt || '');`;

if (source.includes(oldGate)) {
  source = source.replace(oldGate, newGate);
} else if (!source.includes(newGate)) {
  throw new Error('Document edit routing gate target not found');
}

fs.writeFileSync(target, source);
console.log('[Preview Patch] Advisory document requests no longer enter source-edit mode');
