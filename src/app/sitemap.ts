import type { MetadataRoute } from 'next';

export default function sitemap(): MetadataRoute.Sitemap {
  return [
    {
      url: 'https://plurilogai.com/',
      lastModified: new Date('2026-09-25T00:00:00.000Z'),
    },
    {
      url: 'https://plurilogai.com/chatgpt-claude-gemini',
      lastModified: new Date('2026-09-25T00:00:00.000Z'),
    },
    {
      url: 'https://plurilogai.com/ai-pdf-editor',
      lastModified: new Date('2026-09-25T00:00:00.000Z'),
    },
    {
      url: 'https://plurilogai.com/ai-word-document-generator',
      lastModified: new Date('2026-09-25T00:00:00.000Z'),
    },
    {
      url: 'https://plurilogai.com/ai-document-editor',
      lastModified: new Date('2026-09-25T00:00:00.000Z'),
    },
    {
      url: 'https://plurilogai.com/privacy',
      lastModified: new Date('2026-09-14T00:00:00.000Z'),
    },
    {
      url: 'https://plurilogai.com/terms',
      lastModified: new Date('2026-08-30T00:00:00.000Z'),
    },
    {
      url: 'https://plurilogai.com/blog',
      lastModified: new Date('2026-09-25T00:00:00.000Z'),
    },
    {
      url: 'https://plurilogai.com/blog/chatgpt-gemini-image-generation-editing',
      lastModified: new Date('2026-09-20T00:00:00.000Z'),
    },
    {
      url: 'https://plurilogai.com/blog/chatgpt-claude-gemini-shared-conversation',
      lastModified: new Date('2026-09-20T00:00:00.000Z'),
    },
    {
      url: 'https://plurilogai.com/blog/chatgpt-vs-claude-vs-gemini',
      lastModified: new Date('2026-09-13T00:00:00.000Z'),
    },
    {
      url: 'https://plurilogai.com/blog/ai-hallucinations-chatgpt-claude-gemini',
      lastModified: new Date('2026-09-12T00:00:00.000Z'),
    },
  ];
}
