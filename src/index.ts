import * as path from "path";
import { GenericScraper } from "./sources/generic";
import { GitBookScraper } from "./sources/gitbook";
import { NotionScraper } from "./sources/notion";
import { ScraperConfig } from "./types";

const config: ScraperConfig = {
  outputDir: path.join(__dirname, "../data"),
  imagesDir: path.join(__dirname, "../data/images"),
};

async function main() {
  console.log("Starting scraping process...");

  // 1. VNG MijnServices
  const vngScraper = new GenericScraper({
    ...config,
    source: "vng",
    urls: ["https://vng.nl/MijnServices"],
    contentSelector: "article", // Heuristic
  });
  await vngScraper.scrape();

  // 2. StoryBook
  const storybookScraper = new GenericScraper({
    ...config,
    source: "storybook",
    urls: [
      "https://nl-design-system.github.io/mijn-services/?path=/docs/mijnservices-intro--docs",
    ],
    contentSelector: "#root", // Storybook root
    waitForSelector: "#root",
  });
  await storybookScraper.scrape();

  // 3. MijnServices Community
  const communityScraper = new GenericScraper({
    ...config,
    source: "community",
    urls: [
      "https://nldesignsystem.nl/community/community-sprints/mijn-services-community/overzicht/",
    ],
    contentSelector: "main",
  });
  await communityScraper.scrape();

  // 4. NLDS
  const nldsScraper = new GenericScraper({
    ...config,
    source: "nlds",
    urls: ["https://developer.overheid.nl/communities/nl-design-system"],
    contentSelector: "main",
  });
  await nldsScraper.scrape();

  // 5. GitBook
  const gitbookScraper = new GitBookScraper({
    ...config,
    source: "gitbook",
    baseUrl:
      "https://dienstverleningsplatform.gitbook.io/platform-generieke-dienstverlening-public",
  });
  await gitbookScraper.scrape();

  // 6. Notion
  const notionScraper = new NotionScraper({
    ...config,
    source: "notion",
    url: "https://platformvoordienstverlening.notion.site/e9375da1960249bba23c49d038d3c888?v=2b078b5f4db4808da728000c21a96e11",
  });
  await notionScraper.scrape();

  console.log("Scraping completed!");
}

main().catch(console.error);
