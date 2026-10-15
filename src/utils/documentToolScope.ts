/** Keep new-file creation available without offering PDF extraction for a
 * generated document whose editable source and original assets are loaded. */
export function scopeCreationToolsToCanonicalSource<T>(tools: T[], hasCanonicalSource: boolean): T[] {
  if (!hasCanonicalSource) return tools;
  return tools.map(tool => {
    const value = tool as any;
    if (value.function?.name !== 'create_file') return tool;
    const { source_pdf_filename: _extraction, ...properties } = value.function.parameters.properties;
    return {
      ...value,
      function: {
        ...value.function,
        description: 'The existing document has a loaded canonical state with saved original images. For ANY revision, restyle, photo-size adjustment, or format copy of that document, use revise_file. Do not extract photos from its PDF or reconstruct its content. This create_file tool remains available for genuinely separate new documents. ' + value.function.description,
        parameters: { ...value.function.parameters, properties },
      },
    };
  });
}
