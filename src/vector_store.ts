import * as lancedb from "@lancedb/lancedb";
import * as path from "path";
import * as fs from "fs-extra";
import { getEmbedding } from "./embeddings";

const DB_DIR = path.join(__dirname, "../data/lancedb");

export interface Document {
  id: string;
  vector: number[];
  title: string;
  url: string;
  content: string;
  source: string;
}

export class VectorStore {
  private db: lancedb.Connection | null = null;
  private table: lancedb.Table | null = null;

  async initialize() {
    await fs.ensureDir(DB_DIR);
    this.db = await lancedb.connect(DB_DIR);

    // Check if table exists, if not create it
    const tableNames = await this.db.tableNames();
    if (tableNames.includes("documents")) {
      this.table = await this.db.openTable("documents");
    } else {
      // LanceDB creates table schema inference from data, so we can't empty create easily on older versions,
      // but modern versions support schema. For simplicity we'll create with first record or use specific API if needed.
      // We'll leave it null and create on first insert.
    }
  }

  async addDocuments(docs: Omit<Document, "vector">[]) {
    if (!this.db) await this.initialize();

    const data = [];
    for (const doc of docs) {
      console.log(`Generating embedding for: ${doc.title}`);
      const vector = await getEmbedding(doc.content);
      data.push({
        ...doc,
        vector,
      });
    }

    if (!this.table) {
      const tableNames = await this.db!.tableNames();
      if (tableNames.includes("documents")) {
        this.table = await this.db!.openTable("documents");
        await this.table.add(data);
      } else {
        this.table = await this.db!.createTable("documents", data);
      }
    } else {
      await this.table.add(data);
    }
    console.log(`Added ${data.length} documents to vector store.`);
  }

  async reset() {
    await fs.emptyDir(DB_DIR);
    this.db = await lancedb.connect(DB_DIR);
    this.table = null;
    console.log("Vector store reset completed.");
  }

  async search(query: string, limit = 5) {
    if (!this.db) await this.initialize();
    if (!this.table) {
      // Try opening again
      const tableNames = await this.db!.tableNames();
      if (tableNames.includes("documents")) {
        this.table = await this.db!.openTable("documents");
      } else {
        return [];
      }
    }

    const queryVector = await getEmbedding(query);
    const results = await this.table!.vectorSearch(queryVector)
      .distanceType("cosine")
      .limit(limit)
      .toArray();

    return results;
  }

  async listSources() {
    if (!this.db) await this.initialize();
    if (!this.table) {
      const tableNames = await this.db!.tableNames();
      if (tableNames.includes("documents")) {
        this.table = await this.db!.openTable("documents");
      } else {
        return [];
      }
    }

    const rows = await (this.table as any)
      .query()
      .select(["source"])
      .toArray();

    const sources = rows
      .map((row: { source?: string }) => row.source)
      .filter(
        (source: string | undefined): source is string => typeof source === "string",
      );
    const uniqueSources = Array.from(new Set<string>(sources));

    return uniqueSources.sort((a, b) => a.localeCompare(b));
  }
}
