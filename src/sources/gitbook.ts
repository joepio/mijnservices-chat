import { BaseScraper } from "../scraper";
import { ScrapedPage, ScraperConfig } from "../types";
import * as cheerio from "cheerio";
import { chromium } from "playwright";
import path from "path";

export interface GitBookScraperConfig extends ScraperConfig {
  source: string;
  baseUrl: string;
}

export class GitBookScraper extends BaseScraper {
  private gitbookConfig: GitBookScraperConfig;

  constructor(config: GitBookScraperConfig) {
    super(config);
    this.gitbookConfig = config;
  }

  async scrape(): Promise<ScrapedPage[]> {
    const results: ScrapedPage[] = [];
    const browser = await chromium.launch();

    // Set for visited URLs to avoid infinite loops
    const visited = new Set<string>();
    const queue = [this.gitbookConfig.baseUrl];

    try {
      while (queue.length > 0) {
        const url = queue.shift()!;
        if (visited.has(url)) continue;
        visited.add(url);

        console.log(`Scraping GitBook page: ${url}...`);
        const page = await browser.newPage();
        await page.goto(url, { waitUntil: "networkidle" });

        // Gitbook content is usually in main or unknown wrapper, often classes like .gitbook-root
        // We'll try to find a generic main content area.
        // Gitbook usually has a <main> tag.

        const content = await page.content();
        const $ = cheerio.load(content);
        const title = $("h1").first().text().trim() || $("title").text().trim();

        // Find links for recursion
        $("a").each((_, el) => {
          const href = $(el).attr("href");
          if (href) {
            try {
              const absoluteUrl = new URL(href, url).href;
              if (
                absoluteUrl.startsWith(this.gitbookConfig.baseUrl) &&
                !visited.has(absoluteUrl) &&
                !absoluteUrl.includes("#")
              ) {
                queue.push(absoluteUrl);
              }
            } catch (e) {
              // Ignore invalid URLs
            }
          }
        });

        // Clean up
        $("script").remove();
        $("style").remove();

        const contentElement = $("main"); // Gitbook typically uses <main>
        let markdown = "";
        const images: string[] = [];

        if (contentElement.length > 0) {
          // Process images
          const imgElements = contentElement.find("img");
          for (let i = 0; i < imgElements.length; i++) {
            const img = $(imgElements[i]);
            const src = img.attr("src");
            if (src) {
              const absoluteUrl = new URL(src, url).href;
              const localFilename = await this.downloadImage(absoluteUrl, url);
              if (localFilename) {
                img.attr("src", `images/${localFilename}`);
                images.push(path.join(this.config.imagesDir, localFilename));
              }
            }
          }

          markdown = this.turndownService.turndown(contentElement.html() || "");
        }

        const scrapedPage: ScrapedPage = {
          url,
          source: this.gitbookConfig.source,
          title,
          content: markdown,
          images,
        };

        await this.savePage(scrapedPage);
        results.push(scrapedPage);
        await page.close();
      }
    } catch (error) {
      console.error("Error scraping GitBook:", error);
    } finally {
      await browser.close();
    }

    return results;
  }
}
