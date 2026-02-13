import * as fs from "fs-extra";
import * as path from "path";
import axios from "axios";
import TurndownService from "turndown";
import { createHash } from "crypto";
import { ScrapedPage, ScraperConfig } from "./types";

export abstract class BaseScraper {
  protected config: ScraperConfig;
  protected turndownService: TurndownService;

  constructor(config: ScraperConfig) {
    this.config = config;
    this.turndownService = new TurndownService({
      headingStyle: "atx",
      codeBlockStyle: "fenced",
    });
  }

  abstract scrape(): Promise<ScrapedPage[]>;

  protected async downloadImage(
    imageUrl: string,
    referer?: string,
  ): Promise<string | null> {
    try {
      const parsedUrl = new URL(imageUrl);
      const ext = path.extname(parsedUrl.pathname) || ".jpg";
      const hash = createHash("sha256").update(imageUrl).digest("hex");
      const filename = `${hash}${ext}`;
      const filepath = path.join(this.config.imagesDir, filename);

      if (await fs.pathExists(filepath)) {
        return filename;
      }

      const response = await axios.get(imageUrl, {
        responseType: "arraybuffer",
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36",
          ...(referer ? { Referer: referer } : {}),
        },
      });

      await fs.outputFile(filepath, response.data);
      console.log(`Downloaded image: ${imageUrl} -> ${filename}`);
      return filename;
    } catch (error) {
      console.warn(`Failed to download image ${imageUrl}:`, error);
      return null;
    }
  }

  protected async savePage(page: ScrapedPage): Promise<void> {
    const safeTitle = page.title.replace(/[^a-z0-9]/gi, "_").toLowerCase();
    const filename = `${page.source}_${safeTitle}.json`;
    const filepath = path.join(this.config.outputDir, filename);

    await fs.outputJson(filepath, page, { spaces: 2 });
    console.log(`Saved page: ${page.title} -> ${filename}`);
  }
}
