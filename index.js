const { addonBuilder, serveHTTP } = require('stremio-addon-sdk')
const fetch = require('node-fetch')

const TMDB_API_KEY = process.env.TMDB_API_KEY
const PORT = process.env.PORT || 7000

const GENRES = {
          action: 28, adventure: 12, animation: 16, comedy: 35, crime: 80,
          drama: 18, fantasy: 14, horror: 27, mystery: 9648, romance: 10749,
          scifi: 878, thriller: 53, western: 37,
}

const YEAR_OPTIONS = ['2020s','2010s','2000s','1990s','1980s','1970s']

const YEAR_RANGES = {
          '2020s': { gte: '2020-01-01', lte: '2029-12-31' },
          '2010s': { gte: '2010-01-01', lte: '2019-12-31' },
          '2000s': { gte: '2000-01-01', lte: '2009-12-31' },
          '1990s': { gte: '1990-01-01', lte: '1999-12-31' },
          '1980s': { gte: '1980-01-01', lte: '1989-12-31' },
          '1970s': { gte: '1970-01-01', lte: '1979-12-31' },
}

const EMOJI = {
          action:'💥',adventure:'🗺️',animation:'🎨',comedy:'😂',crime:'🔫',
          drama:'🎭',fantasy:'🧙',horror:'🔪',mystery:'🕵️',romance:'❤️',
          scifi:'🚀',thriller:'😰',western:'🤠',
}

const cap = s => s.charAt(0).toUpperCase() + s.slice(1)
const ex  = [{ name: 'year', options: YEAR_OPTIONS }]

const manifest = {
          id: 'com.jerry.custom-tmdb',
          version: '1.3.0',
          name: "Jerry's Picks",
          description: 'Trending + genre browsing via TMDB. Filter by decade in Discover.',
          resources: ['catalog'],
          types: ['movie', 'series'],
          idPrefixes: ['tt'],
          catalogs: [
                      // Home rows
                  { type:'movie',  id:'trending-movies', name:'🔥 Top Trending Movies' },
                  { type:'series', id:'trending-shows',  name:'🔥 Top Trending Shows'  },
                  { type:'movie',  id:'new-movies',      name:'🆕 New This Week — Movies' },
                  { type:'series', id:'new-shows',       name:'🆕 New This Week — Shows'  },
                  { type:'movie',  id:'buzz-movies',     name:'📣 High Buzz Movies' },
                  { type:'series', id:'buzz-shows',      name:'📣 High Buzz Shows'  },
                      // Discover-only: one catalog per genre per type
                      ...Object.keys(GENRES).map(g => ({
                                    type:'movie', id:`${g}-movies`, isInHome:false,
                                    name:`${EMOJI[g]} ${cap(g)} Movies`, extra: ex,
                      })),
                      ...Object.keys(GENRES).map(g => ({
                                    type:'series', id:`${g}-shows`, isInHome:false,
                                    name:`${EMOJI[g]} ${cap(g)} Shows`, extra: ex,
                      })),
                    ],
}

async function tmdb(endpoint, params = {}) {
          const url = new URL(`https://api.themoviedb.org/3${endpoint}`)
          url.searchParams.set('api_key', TMDB_API_KEY)
          url.searchParams.set('language', 'en-US')
          for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v)
          const res = await fetch(url.toString())
          const data = await res.json()
          return data.results || []
}

async function getImdbId(id, mt) {
          try {
                      const r = await fetch(`https://api.themoviedb.org/3/${mt}/${id}/external_ids?api_key=${TMDB_API_KEY}`)
                      return (await r.json()).imdb_id || null
          } catch { return null }
}

function yearParams(yr, mt) {
          if (!yr || !YEAR_RANGES[yr]) return {}
                    const { gte, lte } = YEAR_RANGES[yr]
          const f = mt === 'tv' ? 'first_air_date' : 'primary_release_date'
          return { [`${f}.gte`]: gte, [`${f}.lte`]: lte }
}

async function getResults(id, page, extra = {}) {
          const yr = extra.year || null
          const mt = (id.endsWith('-shows')) ? 'tv' : 'movie'
          const yp = yearParams(yr, mt)

  if (id === 'trending-movies') return tmdb('/trending/movie/week', { page })
          if (id === 'trending-shows')  return tmdb('/trending/tv/week',    { page })
          if (id === 'buzz-movies')     return yr ? tmdb('/discover/movie', { sort_by:'popularity.desc', ...yp, page }) : tmdb('/trending/movie/day', { page })
          if (id === 'buzz-shows')      return yr ? tmdb('/discover/tv',    { sort_by:'popularity.desc', ...yp, page }) : tmdb('/trending/tv/day',    { page })
          if (id === 'new-movies') {
                      const today = new Date().toISOString().split('T')[0]
                      const ago   = new Date(Date.now()-30*864e5).toISOString().split('T')[0]
                      return tmdb('/discover/movie', { sort_by:'popularity.desc', 'primary_release_date.gte':ago, 'primary_release_date.lte':today, page })
          }
          if (id === 'new-shows') {
                      const today = new Date().toISOString().split('T')[0]
                      const ago   = new Date(Date.now()-30*864e5).toISOString().split('T')[0]
                      return tmdb('/discover/tv', { sort_by:'popularity.desc', 'first_air_date.gte':ago, 'first_air_date.lte':today, page })
          }
          // Genre catalogs: format is "<genre>-movies" or "<genre>-shows"
  const genre = id.replace(/-movies$|-shows$/, '')
          const gid   = GENRES[genre]
          if (!gid) return []
                    return tmdb(`/discover/${mt}`, { sort_by:'popularity.desc', with_genres:gid, 'vote_count.gte':50, ...yp, page })
}

function toMeta(item, type, imdbId) {
          return {
                      id: imdbId || `tmdb:${item.id}`, type,
                      name: item.title || item.name,
                      poster: item.poster_path   ? `https://image.tmdb.org/t/p/w500${item.poster_path}` : undefined,
                      background: item.backdrop_path ? `https://image.tmdb.org/t/p/original${item.backdrop_path}` : undefined,
                      description: item.overview,
                      releaseInfo: (item.release_date || item.first_air_date || '').slice(0, 4),
                      imdbRating: item.vote_average ? item.vote_average.toFixed(1) : undefined,
          }
}

const builder = new addonBuilder(manifest)

builder.defineCatalogHandler(async ({ type, id, extra }) => {
          const page = extra?.skip ? Math.floor(extra.skip / 20) + 1 : 1
          const mt   = type === 'series' ? 'tv' : 'movie'
          try {
                      const results = await getResults(id, page, extra || {})
                      const metas = await Promise.all(results.map(async r => {
                                    const imdbId = await getImdbId(r.id, mt)
                                    return toMeta(r, type, imdbId)
                      }))
                      return { metas: metas.filter(m => m.poster && m.id.startsWith('tt')) }
          } catch (err) {
                      console.error(`[catalog] ${id}:`, err.message)
                      return { metas: [] }
          }
})

serveHTTP(builder.getInterface(), { port: PORT })
console.log(`✅ Jerry's addon @ http://localhost:${PORT}/manifest.json`)
