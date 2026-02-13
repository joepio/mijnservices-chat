import { BaseScraper } from "../scraper";
import { ScrapedPage, ScraperConfig } from "../types";
import * as cheerio from "cheerio";
import { chromium } from "playwright";
import path from "path";

export interface GitBookScraperConfig extends ScraperConfig {
  source: string;
  baseUrl: string;
  maxPages?: number;
  pageConcurrency?: number;
  imageConcurrency?: number;
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
    const maxPages = this.gitbookConfig.maxPages || 300;
    const pageConcurrency = this.gitbookConfig.pageConcurrency || 3;
    const imageConcurrency = this.gitbookConfig.imageConcurrency || 4;

    try {
      while (queue.length > 0 && visited.size < maxPages) {
        const batchUrls: string[] = [];
        while (
          queue.length > 0 &&
          batchUrls.length < pageConcurrency &&
          visited.size + batchUrls.length < maxPages
        ) {
          const candidate = queue.shift()!;
          if (!visited.has(candidate)) {
            visited.add(candidate);
            batchUrls.push(candidate);
          }
        }

        const batchResults = await Promise.all(
          batchUrls.map(async (url) => {
            console.log(`Scraping GitBook page: ${url}...`);
            const page = await browser.newPage();
            try {
              await page.goto(url, { waitUntil: "networkidle" });
              const content = await page.content();
              const $ = cheerio.load(content);
              const title = $("h1").first().text().trim() || $("title").text().trim();

              const discovered = new Set<string>();
              $("a").each((_, el) => {
                const href = $(el).attr("href");
                if (!href) return;
                try {
                  const absoluteUrl = new URL(href, url).href.split("#")[0];
                  if (absoluteUrl.startsWith(this.gitbookConfig.baseUrl)) {
                    discovered.add(absoluteUrl);
                  }
                } catch {
                  // Ignore invalid URLs
                }
              });

              $("script").remove();
              $("style").remove();

              const contentElement = $("main");
              let markdown = "";
              const images: string[] = [];

              if (contentElement.length > 0) {
                const imgElements = contentElement.find("img").toArray();
                for (let i = 0; i < imgElements.length; i += imageConcurrency) {
                  const chunk = imgElements.slice(i, i + imageConcurrency);
                  await Promise.all(
                    chunk.map(async (imgEl) => {
                      const img = $(imgEl);
                      const src = img.attr("src");
                      if (!src) return;
                      const absoluteUrl = new URL(src, url).href;
                      const localFilename = await this.downloadImage(absoluteUrl, url);
                      if (localFilename) {
                        img.attr("src", `images/${localFilename}`);
                        images.push(path.join(this.config.imagesDir, localFilename));
                      }
                    }),
                  );
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

              return { page: scrapedPage, links: [...discovered] };
            } finally {
              await page.close();
            }
          }),
        );

        for (const item of batchResults) {
          await this.savePage(item.page);
          results.push(item.page);
          for (const link of item.links) {
            if (!visited.has(link) && !queue.includes(link) && queue.length < maxPages * 2) {
              queue.push(link);
            }
          }
        }
      }

      if (visited.size >= maxPages) {
        console.warn(`Reached GitBook crawl limit (${maxPages}).`);
      }
    } catch (error) {
      console.error("Error scraping GitBook:", error);
    } finally {
      await browser.close();
    }

    return results;
  }
}
