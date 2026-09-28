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

function parseScrapeOnlyEnv(): Set<string> | null {
  const raw = (process.env.SCRAPE_ONLY || "").trim();
  if (!raw) return null;
  const parts = raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return parts.length ? new Set(parts) : null;
}

async function main() {
  console.log("Starting scraping process...");
  const scrapeOnly = parseScrapeOnlyEnv();

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

  // 4b. NL Design System GitHub Discussions
  const nldsDiscussionsScraper = new GenericScraper({
    ...config,
    source: "nlds-discussions",
    urls: ["https://github.com/orgs/nl-design-system/discussions"],
    contentSelector: "main",
    beforeExtract: async (page) => {
      // GitHub loads comment threads progressively; encourage full hydration.
      for (let i = 0; i < 12; i++) {
        await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
        await page.waitForTimeout(350);
      }

      // Expand any "load more / show more" style buttons repeatedly.
      const selectors = [
        'button:has-text("Load more")',
        'button:has-text("Show more")',
        'button:has-text("Show")',
        'summary:has-text("Load more")',
        'summary:has-text("Show more")',
      ];

      for (let pass = 0; pass < 6; pass++) {
        let clicked = 0;
        for (const sel of selectors) {
          const locator = page.locator(sel);
          const count = await locator.count();
          for (let i = 0; i < count; i++) {
            try {
              await locator.nth(i).click({ timeout: 800 });
              clicked++;
              await page.waitForTimeout(200);
            } catch {
              // ignore
            }
          }
        }
        if (clicked === 0) break;
      }
    },
    crawl: true,
    maxPages: 40,
    pageConcurrency: 2,
    imageConcurrency: 1,
    allowedPathPrefixes: ["/orgs/nl-design-system/discussions"],
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

  const allTasks: Array<{ source: string; run: () => Promise<void> }> = [
    { source: "vng", run: () => vngScraper.scrape().then(() => undefined) },
    { source: "storybook", run: () => storybookScraper.scrape().then(() => undefined) },
    { source: "community", run: () => communityScraper.scrape().then(() => undefined) },
    { source: "nlds", run: () => nldsScraper.scrape().then(() => undefined) },
    {
      source: "nlds-discussions",
      run: () => nldsDiscussionsScraper.scrape().then(() => undefined),
    },
    { source: "gitbook", run: () => gitbookScraper.scrape().then(() => undefined) },
    { source: "notion", run: () => notionScraper.scrape().then(() => undefined) },
  ];

  const selectedTasks = scrapeOnly
    ? allTasks.filter((t) => scrapeOnly.has(t.source))
    : allTasks;

  if (scrapeOnly) {
    console.log(`SCRAPE_ONLY enabled. Running sources: ${selectedTasks.map((t) => t.source).join(", ")}`);
  }

  await runWithConcurrency(
    selectedTasks.map((t) => t.run),
    3,
  );

  console.log("Scraping completed!");
}

main().catch(console.error);
