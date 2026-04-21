const { addonBuilder, serveHTTP } = require('stremio-addon-sdk')
const fetch = require('node-fetch')

const TMDB_API_KEY = 'ec86a433b6015ca7b8512a4a76633ae5'
const PORT = 7000

const TMDB_GENRE_IDS = {
  horror: 27, thriller: 53, action: 28, scifi: 878, crime: 80,
}

const manifest = {
  id: 'com.jerry.custom-tmdb',
  version: '1.0.0',
  name: "Jerry's Picks",
  description: 'Fresh trending & top-rated content by genre, updated daily via TMDB.',
  resources: ['catalog'],
  types: ['movie', 'series'],
  idPrefixes: ['tt'],
  catalogs: [
    { type: 'movie',  id: 'trending-movies',        name: '🔥 Top Trending Movies'         },
    { type: 'series', id: 'trending-shows',          name: '🔥 Top Trending Shows'          },
    { type: 'movie',  id: 'new-movies',              name: '🆕 New This Week — Movies'      },
    { type: 'series', id: 'new-shows',               name: '🆕 New This Week — Shows'       },
    { type: 'movie',  id: 'buzz-movies',             name: '📣 High Buzz Movies'            },
    { type: 'series', id: 'buzz-shows',              name: '📣 High Buzz Shows'             },
    { type: 'movie',  id: 'horror-trending',         name: '🔪 Horror Movies — Trending'    },
    { type: 'movie',  id: 'thriller-trending',       name: '🕵️ Thriller Movies — Trending'  },
    { type: 'movie',  id: 'horror-top',              name: '🔪 Horror Movies — Top Rated'   },
    { type: 'movie',  id: 'thriller-top',            name: '🕵️ Thriller Movies — Top Rated' },
    { type: 'movie',  id: 'action-trending',         name: '💥 Action Movies — Trending'    },
    { type: 'movie',  id: 'scifi-trending',          name: '🚀 Sci-Fi Movies — Trending'    },
    { type: 'movie',  id: 'crime-trending',          name: '🔫 Crime Movies — Trending'     },
    { type: 'series', id: 'horror-series-trending',  name: '🔪 Horror Shows — Trending'     },
    { type: 'series', id: 'thriller-series-trending',name: '🕵️ Thriller Shows — Trending'   },
    { type: 'series', id: 'crime-series-trending',   name: '🔫 Crime Shows — Trending'      },
    { type: 'series', id: 'scifi-series-trending',   name: '🚀 Sci-Fi Shows — Trending'     },
  ],
}

async function fetchTMDB(endpoint, params = {}) {
  const url = new URL(`https://api.themoviedb.org/3${endpoint}`)
  url.searchParams.set('api_key', TMDB_API_KEY)
  url.searchParams.set('language', 'en-US')
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v)
  const res = await fetch(url.toString())
  const data = await res.json()
  return data.results || []
}

async function getResults(id, page) {
  const genreMatch = id.match(/^(horror|thriller|action|scifi|crime)/)
  const isSeries = id.includes('series') || id.includes('shows')
  const mediaType = isSeries ? 'tv' : 'movie'

  if (id.startsWith('trending-')) {
    return fetchTMDB(`/trending/${mediaType}/week`, { page })
  }
  if (id.startsWith('new-')) {
    const today = new Date().toISOString().split('T')[0]
    const monthAgo = new Date(Date.now() - 30*24*60*60*1000).toISOString().split('T')[0]
    return fetchTMDB(`/discover/${mediaType}`, {
      sort_by: 'popularity.desc',
      'primary_release_date.gte': monthAgo,
      'primary_release_date.lte': today,
      page,
    })
  }
  if (id.startsWith('buzz-')) {
    return fetchTMDB(`/trending/${mediaType}/day`, { page })
  }
  if (genreMatch) {
    const genreId = TMDB_GENRE_IDS[genreMatch[1]]
    const sortBy = id.endsWith('-top') ? 'vote_average.desc' : 'popularity.desc'
    return fetchTMDB(`/discover/${mediaType}`, {
      sort_by: sortBy,
      with_genres: genreId,
      'vote_count.gte': 100,
      page,
    })
  }
  return []
}

function toMeta(item, type) {
  return {
    id: item.imdb_id || `tmdb:${item.id}`,
    type,
    name: item.title || item.name,
    poster: item.poster_path ? `https://image.tmdb.org/t/p/w500${item.poster_path}` : undefined,
    background: item.backdrop_path ? `https://image.tmdb.org/t/p/original${item.backdrop_path}` : undefined,
    description: item.overview,
    releaseInfo: (item.release_date || item.first_air_date || '').slice(0, 4),
    imdbRating: item.vote_average ? item.vote_average.toFixed(1) : undefined,
  }
}

const builder = new addonBuilder(manifest)

builder.defineCatalogHandler(async ({ type, id, extra }) => {
  const page = extra && extra.skip ? Math.floor(extra.skip / 20) + 1 : 1
  const isSeries = type === 'series'
  try {
    const results = await getResults(id, page)
    const metas = results.map(r => toMeta(r, type)).filter(m => m.poster)
    return { metas }
  } catch (err) {
    console.error(`[catalog] error for ${id}:`, err.message)
    return { metas: [] }
  }
})

serveHTTP(builder.getInterface(), { port: PORT })
console.log(`✅ Jerry's addon running at http://localhost:${PORT}/manifest.json`)
