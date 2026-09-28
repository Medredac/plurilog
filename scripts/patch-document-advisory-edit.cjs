const fs = require('fs');
const path = require('path');

const target = path.join(process.cwd(), 'src/app/api/debate/route.ts');
let source = fs.readFileSync(target, 'utf8');

const oldDescription = "'Edit an existing PDF or DOCX while preserving the original file as the source of truth. Use this for a user-uploaded document, or for a later revision descended from a user-uploaded document, instead of recreating the document with create_file. Make only the requested localized edits. Identify target text exactly as it appears in the source evidence. Use occurrence when the same text appears more than once. For relative font-size requests such as slightly larger/smaller, use font_size_delta_pt (normally +1 or -1) rather than guessing an absolute size. Unmentioned content, layout, tables, images, headers, footers, page geometry, and styling are preserved by the source-edit engine.'";

const newDescription = "'Edit an existing PDF or DOCX while preserving the original file as the source of truth. Use this only when the user is asking you to actually modify the document. Do not call it for advisory, analytical, or hypothetical requests such as asking what should be changed, what is outdated, or how you would update the document; answer those requests normally. For a user-uploaded document, or for a later revision descended from a user-uploaded document, use this instead of recreating the document with create_file. Make only the requested localized edits. Identify target text exactly as it appears in the source evidence. Use occurrence when the same text appears more than once. For relative font-size requests such as slightly larger/smaller, use font_size_delta_pt (normally +1 or -1) rather than guessing an absolute size. Unmentioned content, layout, tables, images, headers, footers, page geometry, and styling are preserved by the source-edit engine.'";

const oldForcedChoice = `                  : sourceDocumentEditingForCurrentTurn
                    ? {
                        tool_choice: {
                          type: 'function',
                          function: { name: 'edit_source_document' },
                        },
                      }
                    : {}),`;

const newForcedChoice = `                  : sourceDocumentEditingForCurrentTurn &&
                      isStrongDocumentMutationRequest(prompt || '')
                    ? {
                        tool_choice: {
                          type: 'function',
                          function: { name: 'edit_source_document' },
                        },
                      }
                    : {}),`;

if (!source.includes(oldDescription)) {
  throw new Error('Document edit tool description target not found');
}
if (!source.includes(oldForcedChoice)) {
  throw new Error('Document edit forced tool-choice target not found');
}

source = source.replace(oldDescription, newDescription);
source = source.replace(oldForcedChoice, newForcedChoice);
fs.writeFileSync(target, source);
console.log('[Preview Patch] Advisory document requests no longer force source editing');
