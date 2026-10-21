// 다음 주 · AI 서버 (Cloudflare Worker)
// 앱이 보낸 대화를 Groq에 전달하고 답을 돌려줘요. Groq 키는 이 서버의 Secret(GROQ_API_KEY)에만 있어요.

// Groq 무료 한도는 모델마다 따로예요(분당 8천 토큰). 한 모델이 한도에 걸리면 다음 모델로 넘어가요.
const CHAIN = {
  default: ['openai/gpt-oss-120b', 'qwen/qwen3.8-27b', 'openai/gpt-oss-20b'],
  complex: ['openai/gpt-oss-120b', 'qwen/qwen3.8-27b', 'openai/gpt-oss-20b'],
  quick: ['openai/gpt-oss-20b', 'qwen/qwen3.8-27b', 'openai/gpt-oss-120b'],
};
const MAX_CHARS = 40000;      // 한 번에 받는 글자 수 상한
const MAX_TOKENS = 1200;      // 답 길이 상한 (한도 계산에 들어가서 낮게)
const PER_MIN = 20;           // 한 사람(IP)이 1분에 보낼 수 있는 횟수

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'POST, OPTIONS',
  'access-control-allow-headers': 'content-type',
  'access-control-max-age': '86400',
  'access-control-expose-headers': 'retry-after',
};
const json = (obj, status = 200, extra = {}) =>
  new Response(JSON.stringify(obj), { status, headers: { ...CORS, 'content-type': 'application/json; charset=utf-8', ...extra } });
const clean = (t) => String(t || '').replace(/<think>[\s\S]*?<\/think>/g, '').trim();

async function tooMany(request, ctx) {
  try {
    const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
    const win = Math.floor(Date.now() / 60000);
    const key = new Request('https://rate.daeum.local/' + encodeURIComponent(ip) + '/' + win);
    const cache = caches.default;
    const hit = await cache.match(key);
    const n = hit ? Number(await hit.text()) || 0 : 0;
    if (n >= PER_MIN) return true;
    ctx.waitUntil(cache.put(key, new Response(String(n + 1), { headers: { 'cache-control': 'max-age=90' } })));
  } catch (e) { /* 제한 확인이 실패해도 서비스는 계속해요 */ }
  return false;
}

async function callGroq(env, body) {
  const r = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Bearer ' + env.GROQ_API_KEY },
    body: JSON.stringify(body),
  });
  return r;
}

export default {
  async fetch(request, env, ctx) {
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
    if (request.method === 'GET') return json({ ok: true, name: 'daeum-ai' });
    if (request.method !== 'POST') return json({ error: 'method' }, 405);
    if (!env.GROQ_API_KEY) return json({ error: 'no_key' }, 500);
    if (await tooMany(request, ctx)) return json({ error: 'rate_limited', by: 'server' }, 429, { 'retry-after': '30' });

    let input;
    try { input = await request.json(); } catch (e) { return json({ error: 'bad_json' }, 400); }
    const msgs = Array.isArray(input.messages) ? input.messages : null;
    if (!msgs || !msgs.length || msgs.length > 30) return json({ error: 'bad_messages' }, 400);
    const list = msgs
      .map((m) => ({ role: m && m.role === 'assistant' ? 'assistant' : 'user', content: String((m && m.content) || '') }))
      .filter((m) => m.content);
    const total = list.reduce((a, m) => a + m.content.length, 0);
    if (!list.length || total > MAX_CHARS) return json({ error: 'too_long' }, 413);

    const wantJson = !!input.json;
    const system = '너는 한국어 일정 앱 \'다음 주\'의 길잡이다. 요청의 지시와 출력 형식을 정확히 따른다.' +
      (wantJson ? ' 반드시 유효한 JSON 객체 하나만 출력하고, 앞뒤에 설명이나 코드 블록을 붙이지 않는다.' : '');
    const chain = CHAIN[input.tier] || CHAIN.default;
    let last = null, wait = 0, anyLimited = false;
    for (const model of chain) {
      const base = { model, messages: [{ role: 'system', content: system }, ...list], max_tokens: MAX_TOKENS, temperature: wantJson ? 0.4 : 0.7 };
      const rf = wantJson ? { response_format: { type: 'json_object' } } : {};
      const effort = model.startsWith('openai/') ? { reasoning_effort: 'low' } : model.startsWith('qwen/') ? { reasoning_effort: 'none' } : {};
      // 모델이 지원하지 않는 옵션이면 하나씩 빼고 다시 시도해요.
      const attempts = [{ ...base, ...effort, ...rf }, { ...base, ...rf }, base];
      let limited = false; // eslint-disable-line no-unused-vars
      for (const body of attempts) {
        let r;
        try { r = await callGroq(env, body); } catch (e) { last = { status: 502, error: 'upstream' }; continue; }
        if (r.status === 429) { limited = true; anyLimited = true; wait = Math.max(wait, Number(r.headers.get('retry-after')) || 0); break; }
        if (r.ok) {
          const data = await r.json();
          const text = clean(data && data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content);
          if (text) return json({ text, model });
          last = { status: 502, error: 'empty' };
          continue;
        }
        if (r.status === 401 || r.status === 403) return json({ error: 'bad_key' }, 500);
        if (r.status === 404) { last = { status: 502, error: 'no_model' }; break; }   // 모델이 없어졌으면 다음 모델로
        last = { status: r.status >= 500 ? 502 : 400, error: 'upstream_' + r.status };
      }
    }
    if (anyLimited) return json({ error: 'rate_limited', by: 'groq' }, 429, { 'retry-after': String(Math.ceil(wait || 20)) });
    return json({ error: (last && last.error) || 'failed' }, (last && last.status) || 502);
  },
};
