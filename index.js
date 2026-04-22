const { addonBuilder, serveHTTP } = require('stremio-addon-sdk')
const fetch = require('node-fetch')

const TMDB_API_KEY = process.env.TMDB_API_KEY
const PORT = process.env.PORT || 7000

const TMDB_GENRE_IDS = {
        action: 28, adventure: 12, animation: 16, comedy: 35, crime: 80,
        documentary: 99, drama: 18, family: 10751, fantasy: 14, history: 36,
        horror: 27, music: 10402, mystery: 9648, romance: 10749, scifi: 878,
        thriller: 53, war: 10752, western: 37,
}

const YEAR_RANGES = {
        '2020s': { gte: '2020-01-01', lte: '2029-12-31' },
        '2010s': { gte: '2010-01-01', lte: '2019-12-31' },
        '2000s': { gte: '2000-01-01', lte: '2009-12-31' },
        '1990s': { gte: '1990-01-01', lte: '1999-12-31' },
        '1980s': { gte: '1980-01-01', lte: '1989-12-31' },
        '1970s': { gte: '1970-01-01', lte: '1979-12-31' },
}

// Home catalogs — trending/new/buzz only (no year filter needed)
const HOME_CATALOGS = [
      { type: 'movie',  id: 'trending-movies', name: '🔥 Top Trending Movies' },
      { type: 'series', id: 'trending-shows',  name: '🔥 Top Trending Shows'  },
      { type: 'movie',  id: 'new-movies',      name: '🆕 New This Week — Movies' },
      { type: 'series', id: 'new-shows',       name: '🆕 New This Week — Shows'  },
      { type: 'movie',  id: 'buzz-movies',     name: '📣 High Buzz Movies' },
      { type: 'series', id: 'buzz-shows',      name: '📣 High Buzz Shows'  },
      ]

const YEAR_OPTIONS = Object.keys(YEAR_RANGES)

// Discover-only genre catalogs — movies with year filter
const MOVIE_GENRE_CATALOGS = Object.entries(TMDB_GENRE_IDS).flatMap(([genre]) => [
      {
                type: 'movie', id: `${genre}-trending`, isInHome: false,
                name: `${genreEmoji(genre)} ${capitalize(genre)} Movies — Trending`,
                extra: [{ name: 'year', options: YEAR_OPTIONS }],
      },
      {
                type: 'movie', id: `${genre}-top`, isInHome: false,
                name: `${genreEmoji(genre)} ${capitalize(genre)} Movies — Top Rated`,
                extra: [{ name: 'year', options: YEAR_OPTIONS }],
      },
      ])

// Discover-only genre catalogs — series with year filter
const SERIES_GENRE_CATALOGS = Object.entries(TMDB_GENRE_IDS).flatMap(([genre]) => [
      {
                type: 'series', id: `${genre}-series-trending`, isInHome: false,
                name: `${genreEmoji(genre)} ${capitalize(genre)} Shows — Trending`,
                extra: [{ name: 'year', options: YEAR_OPTIONS }],
      },
      ])

function capitalize(str) { return str.charAt(0).toUpperCase() + str.slice(1) }

function genreEmoji(genre) {
        const map = {
                  action: '💥', adventure: '🗺️', animation: '🎨', comedy: '😂', crime: '🔫',
                  documentary: '🎥', drama: '🎭', family: '👨‍👩‍👧', fantasy: '🧙', history: '📜',
                  horror: '🔪', music: '🎵', mystery: '🕵️', romance: '❤️', scifi: '🚀',
                  thriller: '😰', war: '⚔️', western: '🤠',
        }
        return map[genre] || '🎬'
}

const manifest = {
        id: 'com.jerry.custom-tmdb',
        version: '1.2.0',
        name: "Jerry's Picks",
        description: 'Fresh trending & genre content via TMDB. Filter by decade in Discover.',
        resources: ['catalog'],
        types: ['movie', 'series'],
        idPrefixes: ['tt'],
        catalogs: [...HOME_CATALOGS, ...MOVIE_GENRE_CATALOGS, ...SERIES_GENRE_CATALOGS],
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

async function getImdbId(tmdbId, mediaType) {
        try {
                  const res = await fetch(`https://api.themoviedb.org/3/${mediaType}/${tmdbId}/external_ids?api_key=${TMDB_API_KEY}`)
                  const data = await res.json()
                  return data.imdb_id || null
        } catch { return null }
}

function getYearParams(yearFilter, mediaType) {
        if (!yearFilter || !YEAR_RANGES[yearFilter]) return {}
                const { gte, lte } = YEAR_RANGES[yearFilter]
        const dateField = mediaType === 'tv' ? 'first_air_date' : 'primary_release_date'
        return {
                  [`${dateField}.gte`]: gte,
                  [`${dateField}.lte`]: lte,
        }
}

async function getResults(id, page, extra = {}) {
        const yearFilter = extra.year || null
        const genreMatch = id.match(/^([a-z]+?)-(series-)?(?:trending|top)/)
        const isSeries = id.includes('-series-')
        const mediaType = isSeries ? 'tv' : 'movie'
        const yearParams = getYearParams(yearFilter, mediaType)

  if (id.startsWith('trending-')) {
            // For trending, if year filter apply discover instead
          if (yearFilter) {
                      return fetchTMDB(`/discover/${mediaType}`, {
                                    sort_by: 'popularity.desc',
                                    ...yearParams, page,
                      })
          }
            return fetchTMDB(`/trending/${mediaType}/week`, { page })
  }
        if (id.startsWith('new-')) {
                  const today = new Date().toISOString().split('T')[0]
                  const monthAgo = new Date(Date.now() - 30*24*60*60*1000).toISOString().split('T')[0]
                  const dateField = mediaType === 'tv' ? 'first_air_date' : 'primary_release_date'
                  return fetchTMDB(`/discover/${mediaType}`, {
                              sort_by: 'popularity.desc',
                              [`${dateField}.gte`]: monthAgo,
                              [`${dateField}.lte`]: today,
                              page,
                  })
        }
        if (id.startsWith('buzz-')) {
                  if (yearFilter) {
                              return fetchTMDB(`/discover/${mediaType}`, {
                                            sort_by: 'popularity.desc',
                                            ...yearParams, page,
                              })
                  }
                  return fetchTMDB(`/trending/${mediaType}/day`, { page })
        }
        if (genreMatch) {
                  const genre = genreMatch[1]
                  const genreId = TMDB_GENRE_IDS[genre]
                  if (!genreId) return []
                            const isTop = id.endsWith('-top')
                  return fetchTMDB(`/discover/${mediaType}`, {
                              sort_by: isTop ? 'vote_average.desc' : 'popularity.desc',
                              with_genres: genreId,
                              'vote_count.gte': 100,
                              ...yearParams,
                              page,
                  })
        }
        return []
}

function toMeta(item, type, imdbId) {
        return {
                  id: imdbId || `tmdb:${item.id}`,
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
        const mediaType = type === 'series' ? 'tv' : 'movie'
        try {
                  const results = await getResults(id, page, extra || {})
                  const metas = await Promise.all(
                              results.map(async r => {
                                            const imdbId = await getImdbId(r.id, mediaType)
                                            return toMeta(r, type, imdbId)
                              })
                            )
                  return { metas: metas.filter(m => m.poster && m.id.startsWith('tt')) }
        } catch (err) {
                  console.error(`[catalog] error for ${id}:`, err.message)
                  return { metas: [] }
        }
})

serveHTTP(builder.getInterface(), { port: PORT })
console.log(`✅ Jerry's addon running at http://localhost:${PORT}/manifest.json`)
