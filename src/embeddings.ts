export {};
import { pipeline } from "@xenova/transformers";

class EmbeddingService {
  private static instance: EmbeddingService;
  private extractor: any;

  private constructor() {}

  public static async getInstance(): Promise<EmbeddingService> {
    if (!EmbeddingService.instance) {
      EmbeddingService.instance = new EmbeddingService();
      try {
        EmbeddingService.instance.extractor = await pipeline(
          "feature-extraction",
          "Xenova/all-MiniLM-L6-v2",
        );
      } catch (e) {
        console.error("Failed to load transformer model", e);
        throw new Error(
          "Embedding model initialization failed. Indexing/search cannot continue.",
        );
      }
    }
    return EmbeddingService.instance;
  }

  public async generateEmbedding(text: string): Promise<number[]> {
    if (!text || text.trim().length === 0) {
      return new Array(384).fill(0);
    }

    // Truncate text if too long
    const truncatedText = text.substring(0, 8000);

    try {
      const output = await this.extractor(truncatedText, {
        pooling: "mean",
        normalize: true,
      });
      return Array.from(output.data);
    } catch (e) {
      console.error("Embedding generation error:", e);
      throw new Error("Embedding generation failed");
    }
  }
}

export const getEmbedding = async (text: string) => {
  const service = await EmbeddingService.getInstance();
  return service.generateEmbedding(text);
};
