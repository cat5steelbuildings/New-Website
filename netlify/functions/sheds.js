// /api/sheds: live Stor-Mor inventory for the Sheds by Cat 5 page (/sheds). Tim, Nov 1 2026.
// Reads the same public inventory feed the Stor-Mor ShedSuite storefronts use (stormor.shedsuite.com):
// an anonymous Firebase sign-in gives a 1-hour token, then /inventory/available is paged by distance from a few
// centers. Only unsold buildings on lots within RADIUS miles of Lake City or Perry are kept.
// The CDN caches the answer for 30 minutes, so Stor-Mor gets a handful of calls an hour, not one per visitor.
// Long term: swap this for an official ShedSuite public-API token (api:read) from Stor-Mor.
const FB_KEY = process.env.SHEDSUITE_FB_KEY || 'AIzaSyAKKAbN32WvGziAlwwA_D5mL7Aq5UndM6E';   // ShedSuite storefront's public web key
const API = 'https://production-ecommerce.shedsuite.com/api/v1/inventory/available';
const COMPANY = 23;                                                     // Stor-Mor
const HOMES = [[30.1855, -82.7108], [30.12, -83.58]];                   // Lake City lot, Perry
const CENTERS = [['30.1855,-82.7108', 'FL'], ['30.12,-83.58', 'FL'], ['30.8,-83.6', 'GA']];
const RADIUS = 125, PAGE = 100, MAXPAGES = 15;

let tok = null, tokAt = 0, cache = null, cacheAt = 0;

const mi = (a, b, c, d) => { const r = Math.PI / 180, x = Math.sin((c - a) * r / 2), y = Math.sin((d - b) * r / 2); return 2 * 3958.8 * Math.asin(Math.sqrt(x * x + Math.cos(a * r) * Math.cos(c * r) * y * y)); };

async function token(){
  if (tok && Date.now() - tokAt < 45 * 60e3) return tok;
  const r = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${FB_KEY}`,
    {method: 'POST', headers: {'content-type': 'application/json', referer: 'https://stormor.shedsuite.com/'}, body: JSON.stringify({returnSecureToken: true})});
  const j = await r.json();
  if (!j.idToken) throw new Error('sign-in failed: ' + ((j.error && j.error.message) || r.status));
  tok = j.idToken; tokAt = Date.now(); return tok;
}

async function page(t, coords, state, skip){
  const q = new URLSearchParams({companyId: COMPANY, coords, state, order: 'distance ASC', skip, limit: PAGE});
  const r = await fetch(`${API}?${q}`, {headers: {Authorization: 'Bearer ' + t, 'Cache-Control': 'no-cache', origin: 'https://stormor.shedsuite.com'}});
  if (r.status === 401) { tok = null; throw new Error('token rejected'); }
  if (!r.ok) throw new Error('feed HTTP ' + r.status);
  return (await r.json()).results || [];
}

async function pull(){
  const t = await token(), items = {}, lots = {};
  for (const [coords, state] of CENTERS){
    for (let p = 0; p < MAXPAGES; p += 3){                              // 3 pages at a time
      const batch = await Promise.all([0, 1, 2].map(k => page(t, coords, state, (p + k) * PAGE)));
      let far = 0, n = 0;
      for (const R of batch) for (const x of R){
        n++;
        const d = Math.min(...HOMES.map(h => mi(h[0], h[1], x.dealerLat, x.dealerLon)));
        if (d > RADIUS) { far++; continue; }
        if (x.soldAt || x.removed || x.excludedFromEcommerce) continue;
        lots[x.locatedAtDealerId] = {n: x.dealerName, lat: x.dealerLat, lon: x.dealerLon, st: x.dealerState};
        items[x.inventoryId] = {id: x.inventoryId, t: x.title, w: x.width, l: x.length, p: x.price, sp: x.salePrice || 0,
          m: Math.round(x.min_rto_price || 0), u: x.condition === 'used' ? 1 : 0, d: x.locatedAtDealerId, img: x.productImageUrl || ''};
      }
      if (!n || far === n || batch.some(R => R.length < PAGE)) break;
    }
  }
  return {at: Date.now(), lots, items: Object.values(items)};
}

exports.handler = async () => {
  try {
    if (!cache || Date.now() - cacheAt > 15 * 60e3){ cache = await pull(); cacheAt = Date.now(); }
    return {statusCode: 200, headers: {'content-type': 'application/json', 'cache-control': 'public, max-age=300',
      'netlify-cdn-cache-control': 'public, durable, s-maxage=1800, stale-while-revalidate=86400'}, body: JSON.stringify(cache)};
  } catch (e) {
    if (cache) return {statusCode: 200, headers: {'content-type': 'application/json', 'cache-control': 'no-store'}, body: JSON.stringify(Object.assign({stale: true}, cache))};
    return {statusCode: 502, headers: {'content-type': 'application/json', 'cache-control': 'no-store'}, body: JSON.stringify({error: String(e.message || e).slice(0, 200)})};
  }
};
