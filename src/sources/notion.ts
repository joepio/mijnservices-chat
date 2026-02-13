import { BaseScraper } from "../scraper";
import { ScrapedPage, ScraperConfig } from "../types";
import * as cheerio from "cheerio";
import { chromium } from "playwright";
import path from "path";
import * as fs from "fs-extra";
import { createHash } from "crypto";

export interface NotionScraperConfig extends ScraperConfig {
  source: string;
  url: string;
  maxPages?: number;
  pageConcurrency?: number;
  imageConcurrency?: number;
  maxRetries?: number;
  retryDelayMs?: number;
  minPageDelayMs?: number;
}

export class NotionScraper extends BaseScraper {
  private notionConfig: NotionScraperConfig;

  constructor(config: NotionScraperConfig) {
    super(config);
    this.notionConfig = config;
  }

  private normalizeNotionUrl(rawUrl: string, baseUrl?: string): string | null {
    try {
      const url = new URL(rawUrl, baseUrl || this.notionConfig.url);
      const base = new URL(this.notionConfig.url);
      if (url.host !== base.host) return null;
      if (url.protocol !== "https:") return null;
      if (
        url.pathname.includes("/login") ||
        url.pathname.includes("/signin") ||
        url.pathname.includes("/signup")
      ) {
        return null;
      }

      // Remove non-content navigational fragments and common preview noise.
      url.hash = "";
      url.searchParams.delete("pvs");
      for (const key of [...url.searchParams.keys()]) {
        if (key !== "v") {
          url.searchParams.delete(key);
        }
      }
      return url.toString();
    } catch {
      return null;
    }
  }

  private async savePageWithUrlHash(page: ScrapedPage): Promise<void> {
    const safeTitle = page.title.replace(/[^a-z0-9]/gi, "_").toLowerCase();
    const urlHash = createHash("sha1").update(page.url).digest("hex").slice(0, 12);
    const filename = `${page.source}_${safeTitle}_${urlHash}.json`;
    const filepath = path.join(this.config.outputDir, filename);
    await fs.outputJson(filepath, page, { spaces: 2 });
    console.log(`Saved page: ${page.title} -> ${filename}`);
  }

  private extractCandidateLinks($: cheerio.CheerioAPI, currentUrl: string): string[] {
    const links = new Set<string>();
    $("a[href]").each((_, el) => {
      const href = $(el).attr("href");
      if (!href) return;
      const normalized = this.normalizeNotionUrl(href, currentUrl);
      if (normalized) links.add(normalized);
    });
    return [...links];
  }

  private isChallengePage(title: string, bodyText: string): boolean {
    const haystack = `${title}\n${bodyText}`.toLowerCase();
    const markers = [
      "just a moment",
      "verify you are human",
      "checking if the site connection is secure",
      "enable javascript and cookies",
      "cloudflare",
      "access denied",
    ];
    return markers.some((marker) => haystack.includes(marker));
  }

  private async sleep(ms: number) {
    if (ms <= 0) return;
    await new Promise((resolve) => setTimeout(resolve, ms));
  }

  async scrape(): Promise<ScrapedPage[]> {
    const results: ScrapedPage[] = [];
    const browser = await chromium.launch();
    const queue: string[] = [];
    const visited = new Set<string>();
    const attempts = new Map<string, number>();
    const maxPages = this.notionConfig.maxPages || 150;
    const pageConcurrency = this.notionConfig.pageConcurrency || 1;
    const imageConcurrency = this.notionConfig.imageConcurrency || 3;
    const maxRetries = this.notionConfig.maxRetries ?? 3;
    const retryDelayMs = this.notionConfig.retryDelayMs ?? 5000;
    const minPageDelayMs = this.notionConfig.minPageDelayMs ?? 350;
    const seed = this.normalizeNotionUrl(this.notionConfig.url);
    if (seed) queue.push(seed);

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
          batchUrls.map(async (currentUrl) => {
            const currentAttempt = attempts.get(currentUrl) ?? 0;
            console.log(`Scraping Notion page: ${currentUrl}...`);
            const page = await browser.newPage();
            try {
              await page.goto(currentUrl, {
                waitUntil: "domcontentloaded",
                timeout: 60000,
              });

              try {
                await page.waitForSelector(".notion-page-content", { timeout: 12000 });
              } catch {
                console.log("Timeout waiting for .notion-page-content, trying body...");
              }
              await page.waitForTimeout(1500);

              const content = await page.content();
              const $ = cheerio.load(content);
              const rawTitle = $("title").text().trim();
              const bodyText = $("body").text().slice(0, 5000);
              if (this.isChallengePage(rawTitle, bodyText)) {
                return {
                  kind: "retry" as const,
                  url: currentUrl,
                  attempt: currentAttempt,
                  reason: rawTitle || "Challenge page detected",
                };
              }

              const discoveredLinks = this.extractCandidateLinks($, currentUrl);

              const title =
                $("h1").first().text().trim() ||
                $("title").text().trim() ||
                "Notion Page";

              $(".notion-topbar").remove();
              $(".notion-sidebar").remove();
              $(".notion-help-button").remove();

              const contentElement = $(".notion-page-content");
              let markdown = "";
              const images: string[] = [];

              contentElement.find("a[href]").each((_, el) => {
                const href = $(el).attr("href");
                if (!href) return;
                const normalized = this.normalizeNotionUrl(href, currentUrl);
                if (normalized) {
                  $(el).attr("href", normalized);
                }
              });

              if (contentElement.length > 0) {
                const imgElements = contentElement.find("img").toArray();
                for (let i = 0; i < imgElements.length; i += imageConcurrency) {
                  const chunk = imgElements.slice(i, i + imageConcurrency);
                  await Promise.all(
                    chunk.map(async (imgEl) => {
                      const img = $(imgEl);
                      const src = img.attr("src");
                      if (!src) return;
                      const absoluteUrl = src.startsWith("http")
                        ? src
                        : new URL(src, currentUrl).href;
                      const localFilename = await this.downloadImage(absoluteUrl, currentUrl);
                      if (localFilename) {
                        img.attr("src", `images/${localFilename}`);
                        images.push(path.join(this.config.imagesDir, localFilename));
                      }
                    }),
                  );
                }
                markdown = this.turndownService.turndown(contentElement.html() || "");
              } else {
                markdown = this.turndownService.turndown($("body").html() || "");
              }

              const scrapedPage: ScrapedPage = {
                url: currentUrl,
                source: this.notionConfig.source,
                title,
                content: markdown,
                images,
              };

              return { kind: "ok" as const, page: scrapedPage, discoveredLinks };
            } catch (error) {
              console.error(`Error scraping Notion page ${currentUrl}:`, error);
              return {
                kind: "retry" as const,
                url: currentUrl,
                attempt: currentAttempt,
                reason: error instanceof Error ? error.message : "Unknown scraping error",
              };
            } finally {
              await page.close();
            }
          }),
        );

        for (const item of batchResults) {
          if (!item) continue;
          if (item.kind === "retry") {
            if (item.attempt < maxRetries) {
              const nextAttempt = item.attempt + 1;
              attempts.set(item.url, nextAttempt);
              console.warn(
                `Notion challenge/retry (${nextAttempt}/${maxRetries}) for ${item.url}: ${item.reason}`,
              );
              await this.sleep(retryDelayMs);
              if (!queue.includes(item.url)) queue.push(item.url);
            } else {
              console.warn(
                `Skipping Notion URL after ${maxRetries} retries: ${item.url} (${item.reason})`,
              );
            }
            continue;
          }
          attempts.delete(item.page.url);
          for (const link of item.discoveredLinks) {
            if (!visited.has(link) && !queue.includes(link) && queue.length < maxPages * 2) {
              queue.push(link);
            }
          }
          await this.savePageWithUrlHash(item.page);
          results.push(item.page);
        }
        await this.sleep(minPageDelayMs);
      }

      if (visited.size >= maxPages) {
        console.warn(
          `Reached Notion crawl limit (${maxPages}). Increase maxPages if needed.`,
        );
      }
    } catch (error) {
      console.error("Error scraping Notion:", error);
    } finally {
      await browser.close();
    }

    return results;
  }
}
