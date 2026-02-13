import { BaseScraper } from "../scraper";
import { ScrapedPage, ScraperConfig } from "../types";
import * as cheerio from "cheerio";
import { chromium, Browser } from "playwright";
import path from "path";

export interface GenericScraperConfig extends ScraperConfig {
  source: string;
  urls: string[];
  contentSelector: string;
  waitForSelector?: string;
  crawl?: boolean;
  maxPages?: number;
  pageConcurrency?: number;
  imageConcurrency?: number;
  allowedPathPrefixes?: string[];
  includeLinkSubstrings?: string[];
  preserveQueryParams?: string[];
}

export class GenericScraper extends BaseScraper {
  private genericConfig: GenericScraperConfig;

  constructor(config: GenericScraperConfig) {
    super(config);
    this.genericConfig = config;
  }

  private normalizeAndFilterUrl(
    rawUrl: string,
    baseUrl: string,
    seedOrigin: string,
  ): string | null {
    try {
      const normalized = new URL(rawUrl, baseUrl);
      if (!["http:", "https:"].includes(normalized.protocol)) return null;
      if (normalized.origin !== seedOrigin) return null;
      normalized.hash = "";

      if (this.genericConfig.preserveQueryParams?.length) {
        const keep = new Set(this.genericConfig.preserveQueryParams);
        for (const key of [...normalized.searchParams.keys()]) {
          if (!keep.has(key)) normalized.searchParams.delete(key);
        }
      } else {
        normalized.search = "";
      }

      const pathName = normalized.pathname.toLowerCase();
      const blockedSuffixes = [
        ".png",
        ".jpg",
        ".jpeg",
        ".webp",
        ".gif",
        ".svg",
        ".pdf",
        ".zip",
        ".css",
        ".js",
        ".xml",
      ];
      if (blockedSuffixes.some((suffix) => pathName.endsWith(suffix))) return null;

      if (this.genericConfig.allowedPathPrefixes?.length) {
        const allowed = this.genericConfig.allowedPathPrefixes.some((prefix) =>
          normalized.pathname.startsWith(prefix),
        );
        if (!allowed) return null;
      }

      if (this.genericConfig.includeLinkSubstrings?.length) {
        const full = normalized.toString().toLowerCase();
        const allowedBySubstring = this.genericConfig.includeLinkSubstrings.some(
          (part) => full.includes(part.toLowerCase()),
        );
        if (!allowedBySubstring) return null;
      }

      return normalized.toString();
    } catch {
      return null;
    }
  }

  private async scrapeSingleUrl(
    url: string,
    browser: Browser,
  ): Promise<{ page: ScrapedPage; discoveredLinks: string[] }> {
    console.log(`Scraping ${url}...`);
    const page = await browser.newPage();
    try {
      await page.goto(url, { waitUntil: "networkidle" });

      if (this.genericConfig.waitForSelector) {
        try {
          await page.waitForSelector(this.genericConfig.waitForSelector, {
            timeout: 5000,
          });
        } catch {
          console.log(
            `Timeout waiting for selector ${this.genericConfig.waitForSelector} on ${url}`,
          );
        }
      }

      const content = await page.content();
      const $ = cheerio.load(content);
      const title = $("title").text().trim() || url;

      const seedOrigin = new URL(this.genericConfig.urls[0]).origin;
      const discoveredLinks = new Set<string>();
      $("a[href]").each((_, el) => {
        const href = $(el).attr("href");
        if (!href) return;
        const normalized = this.normalizeAndFilterUrl(href, url, seedOrigin);
        if (normalized) discoveredLinks.add(normalized);
      });

      // Remove scripts and styles
      $("script").remove();
      $("style").remove();
      $("nav").remove();
      $("header").remove();
      $("footer").remove();

      const contentElement = $(this.genericConfig.contentSelector);
      let markdown = "";
      const images: string[] = [];

      if (contentElement.length > 0) {
        // Process images before converting to markdown (small concurrency for speed).
        const imgElements = contentElement.find("img").toArray();
        const imageConcurrency = this.genericConfig.imageConcurrency || 4;
        for (let i = 0; i < imgElements.length; i += imageConcurrency) {
          const batch = imgElements.slice(i, i + imageConcurrency);
          await Promise.all(
            batch.map(async (imgElement) => {
              const img = $(imgElement);
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

        // Normalize links for better re-use in RAG context.
        contentElement.find("a[href]").each((_, el) => {
          const href = $(el).attr("href");
          if (!href) return;
          try {
            $(el).attr("href", new URL(href, url).href);
          } catch {
            // Ignore invalid links.
          }
        });

        markdown = this.turndownService.turndown(contentElement.html() || "");
      } else {
        console.warn(
          `Content selector ${this.genericConfig.contentSelector} not found on ${url}`,
        );
      }

      return {
        page: {
          url,
          source: this.genericConfig.source,
          title,
          content: markdown,
          images,
        },
        discoveredLinks: [...discoveredLinks],
      };
    } finally {
      await page.close();
    }
  }

  async scrape(): Promise<ScrapedPage[]> {
    const results: ScrapedPage[] = [];
    const browser = await chromium.launch();

    try {
      const maxPages = this.genericConfig.maxPages || 30;
      const pageConcurrency = this.genericConfig.pageConcurrency || 3;
      const crawl = Boolean(this.genericConfig.crawl);

      if (!crawl) {
        for (let i = 0; i < this.genericConfig.urls.length; i += pageConcurrency) {
          const batch = this.genericConfig.urls.slice(i, i + pageConcurrency);
          const batchResults = await Promise.all(
            batch.map(async (url) => this.scrapeSingleUrl(url, browser)),
          );
          for (const item of batchResults) {
            await this.savePage(item.page);
            results.push(item.page);
          }
        }
      } else {
        const seedOrigin = new URL(this.genericConfig.urls[0]).origin;
        const queue: string[] = [];
        const visited = new Set<string>();

        for (const seed of this.genericConfig.urls) {
          const normalized = this.normalizeAndFilterUrl(seed, seed, seedOrigin) || seed;
          if (!queue.includes(normalized)) queue.push(normalized);
        }

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
              try {
                const scraped = await this.scrapeSingleUrl(url, browser);
                return { ok: true as const, value: scraped };
              } catch (error) {
                console.error(`Error scraping ${url}:`, error);
                return { ok: false as const };
              }
            }),
          );

          for (const resultItem of batchResults) {
            if (!resultItem.ok) continue;
            const { page: scrapedPage, discoveredLinks } = resultItem.value;
            await this.savePage(scrapedPage);
            results.push(scrapedPage);

            for (const link of discoveredLinks) {
              if (
                !visited.has(link) &&
                !queue.includes(link) &&
                visited.size + queue.length < maxPages * 2
              ) {
                queue.push(link);
              }
            }
          }
        }

        if (visited.size >= maxPages) {
          console.warn(
            `Reached crawl limit (${maxPages}) for source ${this.genericConfig.source}.`,
          );
        }
      }
    } catch (error) {
      console.error("Error during scraping:", error);
    } finally {
      await browser.close();
    }

    return results;
  }
}
