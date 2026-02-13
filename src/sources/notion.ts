import { BaseScraper } from "../scraper";
import { ScrapedPage, ScraperConfig } from "../types";
import * as cheerio from "cheerio";
import { chromium } from "playwright";
import path from "path";

export interface NotionScraperConfig extends ScraperConfig {
  source: string;
  url: string;
}

export class NotionScraper extends BaseScraper {
  private notionConfig: NotionScraperConfig;

  constructor(config: NotionScraperConfig) {
    super(config);
    this.notionConfig = config;
  }

  async scrape(): Promise<ScrapedPage[]> {
    const results: ScrapedPage[] = [];
    const browser = await chromium.launch();

    try {
      console.log(`Scraping Notion page: ${this.notionConfig.url}...`);
      const page = await browser.newPage();
      await page.goto(this.notionConfig.url, {
        waitUntil: "domcontentloaded",
        timeout: 60000,
      });

      // Notion content loads dynamically. Wait for the main scroller or content.
      try {
        await page.waitForSelector(".notion-page-content", { timeout: 10000 });
      } catch (e) {
        console.log("Timeout waiting for .notion-page-content, trying body...");
      }

      // Expand toggles if possible? (Optional complexity)

      const content = await page.content();
      const $ = cheerio.load(content);
      const title = $("title").text().trim() || "Notion Page";

      // Clean up UI elements
      $(".notion-topbar").remove();
      $(".notion-sidebar").remove();
      $(".notion-help-button").remove();

      const contentElement = $(".notion-page-content");
      let markdown = "";
      const images: string[] = [];

      if (contentElement.length > 0) {
        // Process images
        const imgElements = contentElement.find("img");
        for (let i = 0; i < imgElements.length; i++) {
          const img = $(imgElements[i]);
          const src = img.attr("src");
          if (src) {
            const absoluteUrl = src.startsWith("http")
              ? src
              : new URL(src, this.notionConfig.url).href;
            // Notion images might be authenticated or signed blobs.
            // Public pages usually have accessible URLs.
            const localFilename = await this.downloadImage(
              absoluteUrl,
              this.notionConfig.url,
            );
            if (localFilename) {
              img.attr("src", `images/${localFilename}`);
              images.push(path.join(this.config.imagesDir, localFilename));
            }
          }
        }

        markdown = this.turndownService.turndown(contentElement.html() || "");
      } else {
        // Fallback to body if specific selector fails
        markdown = this.turndownService.turndown($("body").html() || "");
      }

      const scrapedPage: ScrapedPage = {
        url: this.notionConfig.url,
        source: this.notionConfig.source,
        title,
        content: markdown,
        images,
      };

      await this.savePage(scrapedPage);
      results.push(scrapedPage);
    } catch (error) {
      console.error("Error scraping Notion:", error);
    } finally {
      await browser.close();
    }

    return results;
  }
}
