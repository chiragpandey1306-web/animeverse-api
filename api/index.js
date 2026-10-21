
const ANILIST = "https://graphql.anilist.co";

const HEADERS = {
  "Content-Type": "application/json",
  "Accept": "application/json"
};

const animeFields = `
  id
  idMal
  siteUrl
  title { romaji english native }
  description(asHtml: false)
  genres
  averageScore
  episodes
  duration
  season
  seasonYear
  status
  format
  coverImage { large extraLarge }
  bannerImage
  studios(isMain: true) { nodes { name } }
  streamingEpisodes { title thumbnail url site }
`;

async function queryAniList(query, variables = {}) {
  const response = await fetch(ANILIST, {
    method: "POST",
    headers: HEADERS,
    body: JSON.stringify({ query, variables }),
    signal: AbortSignal.timeout(10000)
  });

  if (!response.ok) {
    throw new Error(`AniList returned ${response.status}`);
  }

  const json = await response.json();

  if (json.errors?.length) {
    throw new Error("AniList query failed");
  }

  return json.data;
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "public, s-maxage=300, stale-while-revalidate=600",
      "Access-Control-Allow-Origin": "*"
    }
  });
}

export default {
  async fetch(request) {
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, "") || "/";
    const params = url.searchParams;

    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type"
        }
      });
    }

    if (request.method !== "GET") {
      return json({ error: "Method not allowed" }, 405);
    }

    try {
      if (path === "/" || path === "/api") {
        return json({
          name: "AnimeVerse API",
          version: "1.0.0",
          endpoints: [
            "/api/anime",
            "/api/search?q=naruto",
            "/api/genres",
            "/api/anime/1",
            "/api/anime/1/episodes"
          ],
          note: "Metadata API; video availability is separate."
        });
      }

      if (path === "/api/genres") {
        const data = await queryAniList(`
          query {
            GenreCollection
          }
        `);
        return json({ genres: data.GenreCollection });
      }

      if (path === "/api/anime" || path === "/api/search") {
        const search = (params.get("q") || "").trim().slice(0, 100);
        const genre = (params.get("genre") || "").trim().slice(0, 40);
        const page = Math.min(
          1000,
          Math.max(1, Number(params.get("page")) || 1)
        );
        const perPage = Math.min(
          20,
          Math.max(1, Number(params.get("limit")) || 12)
        );

        const data = await queryAniList(`
          query (
            $page: Int,
            $perPage: Int,
            $search: String,
            $genre: String
          ) {
            Page(page: $page, perPage: $perPage) {
              pageInfo {
                currentPage
                hasNextPage
                total
              }
              media(
                type: ANIME,
                search: $search,
                genre: $genre,
                sort: POPULARITY_DESC,
                isAdult: false
              ) {
                ${animeFields}
              }
            }
          }
        `, {
          page,
          perPage,
          search: search || null,
          genre: genre || null
        });

        return json(data.Page);
      }

      const match = path.match(
        /^\/api\/anime\/(\d+)(?:\/(episodes))?$/
      );

      if (match) {
        const id = Number(match[1]);
        const episodes = Boolean(match[2]);

        const data = await queryAniList(`
          query ($id: Int) {
            Media(id: $id, type: ANIME) {
              ${animeFields}
            }
          }
        `, { id });

        const anime = data.Media;

        if (!anime) {
          return json({ error: "Anime not found" }, 404);
        }

        if (episodes) {
          return json({
            animeId: anime.id,
            title: anime.title,
            episodeCount: anime.episodes,
            availableListings: anime.streamingEpisodes || [],
            note: "Listings are not guaranteed to cover every episode. Check each source's authorization and availability."
          });
        }

        return json(anime);
      }

      return json({ error: "Route not found" }, 404);
    } catch (error) {
      return json({
        error: "Unable to fetch anime data",
        message: error.message
      }, 502);
    }
  }
};
