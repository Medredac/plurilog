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
  ];
}
