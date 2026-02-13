import * as path from "path";
import { GenericScraper } from "./sources/generic";
import { GitBookScraper } from "./sources/gitbook";
import { NotionScraper } from "./sources/notion";
import { ScraperConfig } from "./types";

const config: ScraperConfig = {
  outputDir: path.join(__dirname, "../data"),
  imagesDir: path.join(__dirname, "../data/images"),
};

async function runWithConcurrency(
  tasks: Array<() => Promise<void>>,
  concurrency: number,
) {
  const queue = [...tasks];
  const workers = Array.from({ length: Math.max(1, concurrency) }, async () => {
    while (queue.length > 0) {
      const task = queue.shift();
      if (!task) break;
      await task();
    }
  });
  await Promise.all(workers);
}

async function main() {
  console.log("Starting scraping process...");

  // 1. VNG MijnServices
  const vngScraper = new GenericScraper({
    ...config,
    source: "vng",
    urls: ["https://vng.nl/MijnServices"],
    contentSelector: "article", // Heuristic
    crawl: true,
    maxPages: 40,
    pageConcurrency: 3,
    imageConcurrency: 4,
    includeLinkSubstrings: ["mijnservices", "omnichannel", "wmebv"],
  });

  // 2. StoryBook
  const storybookScraper = new GenericScraper({
    ...config,
    source: "storybook",
    urls: [
      "https://nl-design-system.github.io/mijn-services/?path=/docs/mijnservices-intro--docs",
    ],
    contentSelector: "#root", // Storybook root
    waitForSelector: "#root",
    crawl: false,
    pageConcurrency: 1,
  });

  // 3. MijnServices Community
  const communityScraper = new GenericScraper({
    ...config,
    source: "community",
    urls: [
      "https://nldesignsystem.nl/community/community-sprints/mijn-services-community/",
    ],
    contentSelector: "main",
    crawl: true,
    maxPages: 25,
    pageConcurrency: 3,
    imageConcurrency: 4,
    allowedPathPrefixes: ["/community/community-sprints/mijn-services-community"],
  });

  // 4. NLDS
  const nldsScraper = new GenericScraper({
    ...config,
    source: "nlds",
    urls: ["https://developer.overheid.nl/communities/nl-design-system"],
    contentSelector: "main",
    crawl: true,
    maxPages: 20,
    pageConcurrency: 2,
    imageConcurrency: 3,
    allowedPathPrefixes: ["/communities/nl-design-system"],
  });

  // 5. GitBook
  const gitbookScraper = new GitBookScraper({
    ...config,
    source: "gitbook",
    baseUrl:
      "https://dienstverleningsplatform.gitbook.io/platform-generieke-dienstverlening-public",
    maxPages: 350,
    pageConcurrency: 3,
    imageConcurrency: 4,
  });

  // 6. Notion
  const notionScraper = new NotionScraper({
    ...config,
    source: "notion",
    url: "https://platformvoordienstverlening.notion.site/e9375da1960249bba23c49d038d3c888?v=2b078b5f4db4808da728000c21a96e11",
    maxPages: 250,
    pageConcurrency: 1,
    imageConcurrency: 3,
    maxRetries: 3,
    retryDelayMs: 6000,
    minPageDelayMs: 400,
  });

  await runWithConcurrency(
    [
      () => vngScraper.scrape().then(() => undefined),
      () => storybookScraper.scrape().then(() => undefined),
      () => communityScraper.scrape().then(() => undefined),
      () => nldsScraper.scrape().then(() => undefined),
      () => gitbookScraper.scrape().then(() => undefined),
      () => notionScraper.scrape().then(() => undefined),
    ],
    3,
  );

  console.log("Scraping completed!");
}

main().catch(console.error);
