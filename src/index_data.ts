import { VectorStore } from "./vector_store";
import * as fs from "fs-extra";
import * as path from "path";
import { ScrapedPage } from "./types";
import { v4 as uuidv4 } from "uuid";

const DATA_DIR = path.join(__dirname, "../data");

function splitLongText(text: string, maxSize: number): string[] {
  const pieces: string[] = [];
  let start = 0;
  while (start < text.length) {
    pieces.push(text.slice(start, start + maxSize).trim());
    start += maxSize;
  }
  return pieces.filter(Boolean);
}

function getOverlapTail(text: string, overlapChars: number): string {
  if (overlapChars <= 0 || text.length === 0) return "";

  const words = text.trim().split(/\s+/);
  const tail: string[] = [];
  let length = 0;

  for (let i = words.length - 1; i >= 0; i--) {
    const nextLength = length + words[i].length + (tail.length > 0 ? 1 : 0);
    if (nextLength > overlapChars) break;
    tail.unshift(words[i]);
    length = nextLength;
  }

  return tail.join(" ");
}

function chunkText(
  text: string,
  chunkSize: number = 1000,
  overlap: number = 200,
): string[] {
  if (!text || !text.trim()) return [];

  const normalizedText = text.replace(/\r\n/g, "\n");
  const paragraphs = normalizedText
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean);

  const units: string[] = [];
  for (const paragraph of paragraphs) {
    if (paragraph.length <= chunkSize) {
      units.push(paragraph);
      continue;
    }

    const sentences = paragraph
      .split(/(?<=[.!?])\s+/)
      .map((s) => s.trim())
      .filter(Boolean);

    if (sentences.length <= 1) {
      units.push(...splitLongText(paragraph, chunkSize));
      continue;
    }

    for (const sentence of sentences) {
      if (sentence.length <= chunkSize) {
        units.push(sentence);
      } else {
        units.push(...splitLongText(sentence, chunkSize));
      }
    }
  }

  const chunks: string[] = [];
  let currentChunk = "";

  for (const unit of units) {
    if (!currentChunk) {
      currentChunk = unit;
      continue;
    }

    const candidate = `${currentChunk}\n\n${unit}`;
    if (candidate.length <= chunkSize) {
      currentChunk = candidate;
      continue;
    }

    chunks.push(currentChunk);
    const tail = getOverlapTail(currentChunk, overlap);
    currentChunk = tail ? `${tail}\n\n${unit}` : unit;

    if (currentChunk.length > chunkSize) {
      const splitUnits = splitLongText(currentChunk, chunkSize);
      chunks.push(...splitUnits.slice(0, -1));
      currentChunk = splitUnits[splitUnits.length - 1] || "";
    }
  }

  if (currentChunk) {
    chunks.push(currentChunk);
  }

  return chunks;
}

async function main() {
  console.log("Starting indexing process...");
  const vectorStore = new VectorStore();
  await vectorStore.initialize();
  await vectorStore.reset();

  const files = await fs.readdir(DATA_DIR);
  for (const file of files) {
    if (!file.endsWith(".json")) continue;

    const filePath = path.join(DATA_DIR, file);
    try {
      const page: ScrapedPage = await fs.readJson(filePath);
      if (!page.content) continue;

      console.log(`Processing ${file}...`);

      // Chunk content
      const chunks = chunkText(page.content);
      const docs = chunks.map((chunk, i) => ({
        id: uuidv4(),
        title: `${page.title} (Part ${i + 1})`,
        url: page.url,
        content: chunk,
        source: page.source,
      }));

      await vectorStore.addDocuments(docs);
    } catch (e) {
      console.warn(`Failed to process ${file}:`, e);
    }
  }

  console.log("Indexing completed!");
}

main().catch(console.error);
