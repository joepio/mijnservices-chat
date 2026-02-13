import { BaseScraper } from "../scraper";
import { ScrapedPage, ScraperConfig } from "../types";
import * as cheerio from "cheerio";
import { chromium, Browser, Page } from "playwright";
import path from "path";

export interface GenericScraperConfig extends ScraperConfig {
  source: string;
  urls: string[];
  contentSelector: string;
  waitForSelector?: string;
}

export class GenericScraper extends BaseScraper {
  private genericConfig: GenericScraperConfig;

  constructor(config: GenericScraperConfig) {
    super(config);
    this.genericConfig = config;
  }

  async scrape(): Promise<ScrapedPage[]> {
    const results: ScrapedPage[] = [];
    const browser = await chromium.launch();

    try {
      for (const url of this.genericConfig.urls) {
        console.log(`Scraping ${url}...`);
        const page = await browser.newPage();
        await page.goto(url, { waitUntil: "networkidle" });

        if (this.genericConfig.waitForSelector) {
          try {
            await page.waitForSelector(this.genericConfig.waitForSelector, {
              timeout: 5000,
            });
          } catch (e) {
            console.log(
              `Timeout waiting for selector ${this.genericConfig.waitForSelector} on ${url}`,
            );
          }
        }

        const content = await page.content();
        const $ = cheerio.load(content);
        const title = $("title").text().trim() || url;

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
          // Process images before converting to markdown
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
        } else {
          console.warn(
            `Content selector ${this.genericConfig.contentSelector} not found on ${url}`,
          );
        }

        const scrapedPage: ScrapedPage = {
          url,
          source: this.genericConfig.source,
          title,
          content: markdown,
          images,
        };

        await this.savePage(scrapedPage);
        results.push(scrapedPage);
        await page.close();
      }
    } catch (error) {
      console.error("Error during scraping:", error);
    } finally {
      await browser.close();
    }

    return results;
  }
}
