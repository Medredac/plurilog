import { preservesDocumentEquations } from './documentMath';

/** Per-turn document correction budget; distinct filenames/formats remain independent. */
export function createDocumentGenerationGuard() {
  const outputs = new Map<string, { attempts: number; spec?: unknown }>();
  const key = (filename: string, format: string) => `${format}:${filename.split(/[\\/]/).pop()!.trim().toLowerCase()}`;
  return {
    begin(filename: string, format: string, spec: unknown) {
      const id = key(filename, format);
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
      const id = key(filename, format);
      outputs.set(id, { attempts: outputs.get(id)?.attempts || 1, spec });
    },
  };
}
