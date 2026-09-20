import type { MetadataRoute } from 'next';

export default function sitemap(): MetadataRoute.Sitemap {
  return [
    {
      url: 'https://plurilogai.com/',
    },
    {
      url: 'https://plurilogai.com/privacy',
    },
    {
      url: 'https://plurilogai.com/terms',
    },
    {
      url: 'https://plurilogai.com/blog',
    },
    {
      url: 'https://plurilogai.com/blog/chatgpt-gemini-image-generation-editing',
    },
    {
      url: 'https://plurilogai.com/blog/chatgpt-claude-gemini-shared-conversation',
    },
    {
      url: 'https://plurilogai.com/blog/chatgpt-vs-claude-vs-gemini',
    },
    {
      url: 'https://plurilogai.com/blog/ai-hallucinations-chatgpt-claude-gemini',
    },
  ];
}
