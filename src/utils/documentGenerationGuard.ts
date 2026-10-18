import { preservesDocumentEquations } from './documentMath';

/** Per-turn document correction budget; renaming a document with the same title does not reset its budget. */
export function createDocumentGenerationGuard() {
  const outputs = new Map<string, { attempts: number; spec?: unknown }>();
  const key = (filename: string, format: string) => `${format}:${filename.split(/[\\/]/).pop()!.trim().toLowerCase()}`;
  const aliases = new Map<string, string>();
  const identity = (filename: string, format: string, spec: unknown) => {
    const fileKey = key(filename, format);
    const title = spec && typeof spec === 'object' && 'title' in spec && typeof spec.title === 'string'
      ? spec.title.trim().toLowerCase().replace(/\s+/g, ' ') : '';
    const titleKey = title ? `${format}:title:${title}` : fileKey;
    const id = aliases.get(fileKey) || aliases.get(titleKey) || fileKey;
    aliases.set(fileKey, id);
    aliases.set(titleKey, id);
    return id;
  };
  return {
    begin(filename: string, format: string, spec: unknown) {
      const id = identity(filename, format, spec);
      const previous = outputs.get(id);
      if (previous?.spec && !preservesDocumentEquations(previous.spec, spec)) {
        throw new Error('This rewrite removes or changes equations from the file already saved in this turn. Retain the original LaTeX exactly when correcting layout. Do not replace it with Unicode or ASCII approximations.');
      }
      if ((previous?.attempts || 0) >= 2) {
        throw new Error('This file has reached its creation/correction limit for this turn. Do not create it again or rename it to retry. Deliver the saved version, describe any remaining defect honestly, and complete any other requested format.');
      }
      outputs.set(id, { ...previous, attempts: (previous?.attempts || 0) + 1 });
    },
    saved(filename: string, format: string, spec: unknown) {
      const id = identity(filename, format, spec);
      outputs.set(id, { attempts: outputs.get(id)?.attempts || 1, spec });
    },
  };
}
