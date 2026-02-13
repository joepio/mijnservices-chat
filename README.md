# MijnServices Wiki

## Doel

Alle bestaande, gefragmenteerde kennis uit verschillende bronnen samenvoegen op een sub-site van Developer.overheid.nl.

@terborg en ik moeten de documentatie, kennis en informatie over MijnServices bij elkaar rapen, zodat je een goed beeld krijgt van wat er allemaal relevant is voor het koppelen van MijnServices.

- Ambtenaren / leveranciers die veel doen aan wet digitale dienstverlening / overheidsbeleving

## Databronnen

- [ ] [VNG MijnServices site](https://vng.nl/MijnServices)
- [ ] VNG R Omnichannel Microsoft Teams Bestanden (intern)
- [ ] [StoryBook](https://nl-design-system.github.io/mijn-services/?path=/docs/mijnservices-intro--docs)
- [ ] [MijnServices Community](https://nldesignsystem.nl/community/community-sprints/mijn-services-community/overzicht/)
- [ ] CG Samenwerken [Notion Backlog](https://platformvoordienstverlening.notion.site/e9375da1960249bba23c49d038d3c888?v=2b078b5f4db4808da728000c21a96e11)
- [ ] [NLDS](https://developer.overheid.nl/communities/nl-design-system)
- [ ] [GitBook Dienstverleningsplatform](https://dienstverleningsplatform.gitbook.io/platform-generieke-dienstverlening-public)

## Aanpak

Suggestie: we scrapen / laden alle informatie uit al deze bronnen en converteren het naar plaintext. We nemen een SOTA LLM en genereren de documentatie pagina's.

## Publicatie wensen

DON werkt met Docusaurus, de kennisbank dan vooral. Hier heeft @terborg al een opzet voor gemaakt.

## Development

### Scraper

To collect the data from the various sources, we use a custom scraping script.

1. Install dependencies:
   ```bash
   pnpm install
   pnpm exec playwright install
   ```

2. Run the scrapers:
   ```bash
   pnpm exec ts-node src/index.ts
   ```

Data will be saved in the `data/` directory. Images are downloaded to `data/images`.

### Local Search & Frontend

We use **LanceDB** for vector search and a **React** frontend.

1. **Index Data** (Generate embeddings):
   ```bash
   pnpm exec ts-node src/index_data.ts
   ```

2. **(Optional) Configure chat LLM provider** in `.env`:
   ```bash
   # Generic (OpenAI-compatible) settings
   LLM_PROVIDER=openrouter
   LLM_API_KEY=...
   LLM_MODEL=openai/gpt-4o-mini
   LLM_BASE_URL=https://openrouter.ai/api/v1

   # Optional OpenRouter headers
   OPENROUTER_HTTP_REFERER=http://localhost:5152
   OPENROUTER_X_TITLE=MijnServices Wiki
   ```
   Notes:
   - If no LLM key is configured, chat falls back to extractive answers from retrieved chunks.
   - You can also use OpenAI by setting `LLM_PROVIDER=openai` with `LLM_API_KEY` (or `OPENAI_API_KEY`).

3. **Start Backend Server**:
   ```bash
   pnpm exec ts-node src/server.ts
   ```

4. **Start Frontend** (in a new terminal):
   ```bash
   cd frontend
   pnpm dev
   ```
   Open [http://localhost:5152](http://localhost:5152) to search.
J
