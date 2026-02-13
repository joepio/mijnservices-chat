import "dotenv/config";
import express from "express";
import cors from "cors";
import { VectorStore } from "./vector_store";
import * as path from "path";
import * as fs from "fs-extra";
import { ScrapedPage } from "./types";

const app = express();
const port = 3000;
const DATA_DIR = path.join(__dirname, "../data");

app.use(cors());
app.use(express.json());
// Serve static images
app.use("/images", express.static(path.join(__dirname, "../data/images")));

const vectorStore = new VectorStore();

type LlmProvider = "openai" | "openrouter" | "custom";

interface LlmConfig {
  enabled: boolean;
  provider: LlmProvider;
  apiKey: string;
  model: string;
  baseUrl: string;
  headers: Record<string, string>;
}

function resolveLlmConfig(): LlmConfig {
  const rawProvider = (process.env.LLM_PROVIDER || "auto").toLowerCase();
  const autoProvider: LlmProvider = process.env.OPENROUTER_API_KEY
    ? "openrouter"
    : "openai";
  const provider: LlmProvider =
    rawProvider === "openai" || rawProvider === "openrouter" || rawProvider === "custom"
      ? rawProvider
      : autoProvider;

  const apiKey =
    process.env.LLM_API_KEY ||
    (provider === "openrouter"
      ? process.env.OPENROUTER_API_KEY
      : process.env.OPENAI_API_KEY) ||
    "";
  const model =
    process.env.LLM_MODEL ||
    (provider === "openrouter"
      ? process.env.OPENROUTER_MODEL
      : process.env.OPENAI_MODEL) ||
    "gpt-4o-mini";
  const defaultBaseUrl =
    provider === "openrouter"
      ? "https://openrouter.ai/api/v1"
      : "https://api.openai.com/v1";
  const baseUrl = (process.env.LLM_BASE_URL || defaultBaseUrl).replace(/\/$/, "");
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };

  if (apiKey) {
    headers.Authorization = `Bearer ${apiKey}`;
  }

  if (provider === "openrouter") {
    const referer = process.env.OPENROUTER_HTTP_REFERER || process.env.OPENROUTER_SITE_URL;
    const title = process.env.OPENROUTER_X_TITLE || process.env.OPENROUTER_APP_NAME;
    if (referer) headers["HTTP-Referer"] = referer;
    if (title) headers["X-Title"] = title;
  }

  return {
    enabled: Boolean(apiKey),
    provider,
    apiKey,
    model,
    baseUrl,
    headers,
  };
}

const llmConfig = resolveLlmConfig();

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

interface SearchRow {
  source: string;
  title: string;
  url: string;
  content: string;
  _distance?: number;
}

interface ChatContext {
  contextRows: SearchRow[];
  selectedSources: string[];
  sources: Array<{
    title: string;
    url: string;
    source: string;
    excerpt: string;
  }>;
}

async function findDocumentByUrl(
  targetUrl: string,
  source?: string,
): Promise<ScrapedPage | null> {
  const files = await fs.readdir(DATA_DIR);
  for (const file of files) {
    if (!file.endsWith(".json")) continue;
    const filePath = path.join(DATA_DIR, file);
    try {
      const page = (await fs.readJson(filePath)) as ScrapedPage;
      if (page.url !== targetUrl) continue;
      if (source && page.source !== source) continue;
      return page;
    } catch (error) {
      console.warn(`Failed to read ${filePath}:`, error);
    }
  }
  return null;
}

function trimExcerpt(text: string, maxLength = 280) {
  const singleLine = text.replace(/\s+/g, " ").trim();
  if (singleLine.length <= maxLength) return singleLine;
  return `${singleLine.slice(0, maxLength).trim()}...`;
}

async function generateGroundedAnswer(
  question: string,
  contextRows: SearchRow[],
  history: ChatMessage[],
  selectedSources: string[],
) {
  if (contextRows.length === 0) {
    return "I could not find relevant context in the indexed sources for this question.";
  }

  if (!llmConfig.enabled) {
    const fallbackBullets = contextRows
      .slice(0, 3)
      .map(
        (row, idx) =>
          `${idx + 1}. **${row.title}** (${row.source}) - ${trimExcerpt(row.content)}`,
      )
      .join("\n");

    return [
      "No LLM API key configured, so this is an extractive answer from top matches.",
      "",
      fallbackBullets,
    ].join("\n");
  }

  const historyMessages = history.slice(-8).map((message) => ({
    role: message.role,
    content: message.content,
  }));

  const messages = buildLlmMessages(question, contextRows, history, selectedSources);

  const response = await fetch(`${llmConfig.baseUrl}/chat/completions`, {
    method: "POST",
    headers: llmConfig.headers,
    body: JSON.stringify({
      model: llmConfig.model,
      messages,
      temperature: 0.2,
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(
      `LLM request failed (${llmConfig.provider}, ${response.status}): ${body}`,
    );
  }

  const payload = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const answer = payload.choices?.[0]?.message?.content?.trim();
  if (!answer) {
    throw new Error(`LLM provider ${llmConfig.provider} returned an empty answer`);
  }
  return answer;
}

function buildLlmMessages(
  question: string,
  contextRows: SearchRow[],
  history: ChatMessage[],
  selectedSources: string[],
) {
  const contextBlock = contextRows
    .map((row, idx) => {
      return [
        `Bron ${idx + 1}:`,
        `- titel: ${row.title}`,
        `- bron: ${row.source}`,
        `- url: ${row.url}`,
        `- fragment: ${trimExcerpt(row.content, 900)}`,
      ].join("\n");
    })
    .join("\n\n");

  const historyMessages = history.slice(-8).map((message) => ({
    role: message.role,
    content: message.content,
  }));
  const indexedDataSources = [
    "VNG MijnServices",
    "GitBook Dienstverleningsplatform",
    "Notion Backlog",
    "Storybook (NL Design System)",
    "MijnServices Community",
    "NL Design System (developer.overheid.nl)",
  ];
  const contextSources = Array.from(new Set(contextRows.map((row) => row.source)));
  const activeSourceFilterText =
    selectedSources.length > 0 ? selectedSources.join(", ") : "geen (alle bronnen toegestaan)";
  const relevantContextSourcesText =
    contextSources.length > 0 ? contextSources.join(", ") : "geen";

  return [
    {
      role: "system",
      content:
        [
          "Je bent de assistent voor VNG MijnServices-documentatie.",
          "Je antwoordt ALTIJD in het Nederlands.",
          "Gebruik uitsluitend de meegegeven context en verzin geen feiten.",
          "Als context ontbreekt of onvoldoende is, zeg dat expliciet en geef aan wat nog nodig is.",
          "Houd antwoorden compact, praktisch en in Markdown.",
          "Begin direct met het antwoord; gebruik geen inleidende herhaling van de vraag.",
          "Herhaal de vraag van de gebruiker nooit letterlijk.",
          "Gebruik geen kop die de vraag herhaalt (bijvoorbeeld 'Wat is ...?').",
          "Noem aan het einde kort de gebruikte bronnen onder kopje 'Bronnen'.",
          `Databronnen in deze wiki: ${indexedDataSources.join(", ")}.`,
        ].join(" "),
    },
    ...historyMessages,
    {
      role: "user",
      content: [
        "Vraag:",
        question,
        "",
        `Actieve bronfilters: ${activeSourceFilterText}`,
        `Relevante contextbronnen voor deze vraag: ${relevantContextSourcesText}`,
        "",
        "Context:",
        contextBlock,
      ].join("\n"),
    },
  ];
}

async function buildChatContext(
  question: string,
  selectedSources: string[],
): Promise<ChatContext> {
  const searchRows = (await vectorStore.search(question, 30)) as SearchRow[];
  const filteredRows =
    selectedSources.length > 0
      ? searchRows.filter((row) => selectedSources.includes(row.source))
      : searchRows;
  const contextRows = filteredRows.slice(0, 6);
  const sources = contextRows.map((row) => ({
    title: row.title,
    url: row.url,
    source: row.source,
    excerpt: trimExcerpt(row.content),
  }));
  return { contextRows, selectedSources, sources };
}

function writeSseEvent(res: express.Response, event: string, payload: unknown) {
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(payload)}\n\n`);
}

async function streamGroundedAnswer(
  question: string,
  contextRows: SearchRow[],
  history: ChatMessage[],
  selectedSources: string[],
  onToken: (chunk: string) => void,
) {
  if (contextRows.length === 0) {
    const noContext =
      "I could not find relevant context in the indexed sources for this question.";
    onToken(noContext);
    return noContext;
  }

  if (!llmConfig.enabled) {
    const fallbackBullets = contextRows
      .slice(0, 3)
      .map(
        (row, idx) =>
          `${idx + 1}. **${row.title}** (${row.source}) - ${trimExcerpt(row.content)}`,
      )
      .join("\n");
    const fallback = [
      "No LLM API key configured, so this is an extractive answer from top matches.",
      "",
      fallbackBullets,
    ].join("\n");
    onToken(fallback);
    return fallback;
  }

  const messages = buildLlmMessages(question, contextRows, history, selectedSources);
  const response = await fetch(`${llmConfig.baseUrl}/chat/completions`, {
    method: "POST",
    headers: llmConfig.headers,
    body: JSON.stringify({
      model: llmConfig.model,
      messages,
      temperature: 0.2,
      stream: true,
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(
      `LLM request failed (${llmConfig.provider}, ${response.status}): ${body}`,
    );
  }

  if (!response.body) {
    throw new Error("LLM stream response body is missing");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let accumulated = "";
  let buffer = "";

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    let newlineIndex = buffer.indexOf("\n");
    while (newlineIndex !== -1) {
      const line = buffer.slice(0, newlineIndex).trim();
      buffer = buffer.slice(newlineIndex + 1);

      if (line.startsWith("data: ")) {
        const payload = line.slice(6).trim();
        if (payload === "[DONE]") {
          newlineIndex = buffer.indexOf("\n");
          continue;
        }
        try {
          const parsed = JSON.parse(payload) as {
            choices?: Array<{ delta?: { content?: string } }>;
          };
          const chunk = parsed.choices?.[0]?.delta?.content;
          if (chunk) {
            accumulated += chunk;
            onToken(chunk);
          }
        } catch {
          // Ignore malformed SSE lines from provider.
        }
      }
      newlineIndex = buffer.indexOf("\n");
    }
  }

  if (!accumulated.trim()) {
    throw new Error(`LLM provider ${llmConfig.provider} returned an empty answer`);
  }

  return accumulated;
}

app.get("/sources", async (_req, res) => {
  try {
    const sources = await vectorStore.listSources();
    res.json({ sources });
  } catch (error) {
    console.error("Failed to list sources:", error);
    res.status(500).send("Internal Server Error");
  }
});

app.get("/document", async (req, res) => {
  const url = req.query.url as string | undefined;
  const source = req.query.source as string | undefined;
  if (!url) {
    res.status(400).send("Missing query parameter url");
    return;
  }

  try {
    const doc = await findDocumentByUrl(url, source);
    if (!doc) {
      res.status(404).send("Document not found");
      return;
    }
    res.json(doc);
  } catch (error) {
    console.error("Failed to load document:", error);
    res.status(500).send("Internal Server Error");
  }
});

app.post("/chat", async (req, res) => {
  const question = String(req.body?.question || "").trim();
  const selectedSources = Array.isArray(req.body?.selectedSources)
    ? (req.body.selectedSources as string[])
    : [];
  const history = Array.isArray(req.body?.history)
    ? (req.body.history as ChatMessage[])
    : [];

  if (!question) {
    res.status(400).send("Missing body field question");
    return;
  }

  try {
    const { contextRows, sources } = await buildChatContext(question, selectedSources);
    const answer = await generateGroundedAnswer(
      question,
      contextRows,
      history,
      selectedSources,
    );

    res.json({ answer, sources });
  } catch (error) {
    console.error("Chat failed:", error);
    res.status(500).send("Internal Server Error");
  }
});

app.post("/chat/stream", async (req, res) => {
  const question = String(req.body?.question || "").trim();
  const selectedSources = Array.isArray(req.body?.selectedSources)
    ? (req.body.selectedSources as string[])
    : [];
  const history = Array.isArray(req.body?.history)
    ? (req.body.history as ChatMessage[])
    : [];

  if (!question) {
    res.status(400).send("Missing body field question");
    return;
  }

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");

  try {
    const { contextRows, selectedSources: activeSources, sources } = await buildChatContext(
      question,
      selectedSources,
    );
    const answer = await streamGroundedAnswer(
      question,
      contextRows,
      history,
      activeSources,
      (chunk) => writeSseEvent(res, "token", { chunk }),
    );
    writeSseEvent(res, "done", { answer, sources });
  } catch (error) {
    console.error("Chat stream failed:", error);
    writeSseEvent(res, "error", {
      message: error instanceof Error ? error.message : "Streaming failed",
    });
  } finally {
    res.end();
  }
});

app.get("/search", async (req, res) => {
  const query = req.query.q as string;
  if (!query) {
    res.status(400).send("Missing query parameter q");
    return;
  }

  try {
    console.log(`Searching for: ${query}`);
    const results = await vectorStore.search(query, 10);
    res.json(results);
  } catch (error) {
    console.error("Search failed:", error);
    res.status(500).send("Internal Server Error");
  }
});

app.listen(port, () => {
  console.log(`Server listening at http://localhost:${port}`);
});
