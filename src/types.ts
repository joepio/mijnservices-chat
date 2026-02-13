export interface ScrapedPage {
  url: string;
  source: string; // e.g., 'vng', 'nlds', 'gitbook'
  title: string;
  content: string; // Markdown content
  images: string[]; // List of local paths to images
  metadata?: Record<string, any>;
}

export interface ScraperConfig {
  outputDir: string;
  imagesDir: string;
}
