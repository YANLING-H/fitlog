// Food photo / text estimation and the weekly coach, through the Claude API, called straight from the browser
// with the user's own API key (kept in localStorage on this device only).
// The SDK is vendored (vendor/anthropic-sdk.mjs, @anthropic-ai/sdk 0.133.0; rebuild with scripts/build-sdk.sh)
// and loaded on first use so the rest of the app never depends on it.
let sdk = null;
async function loadSdk() {
  if (!sdk) sdk = (await import("./vendor/anthropic-sdk.mjs")).default;
  return sdk;
}

const KEY = "fitlog:apiKey";
const MODEL = "fitlog:model";
export const DEFAULT_MODEL = "claude-opus-5-5";

export function getKey() { try { return localStorage.getItem(KEY) || ""; } catch { return ""; } }
export function setKey(k) { try { k ? localStorage.setItem(KEY, k) : localStorage.removeItem(KEY); } catch {} }
export function getModel() { try { return localStorage.getItem(MODEL) || DEFAULT_MODEL; } catch { return DEFAULT_MODEL; } }
export function setModel(m) { try { localStorage.setItem(MODEL, m); } catch {} }

// The model names foods and estimates grams; per-100 g values let the app recompute every number
// locally when the user changes grams (and the local food table overrides them when it knows the food).
const MEAL_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["items", "confidence", "note"],
  properties: {
    items: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["name", "amount", "grams", "grams_low", "grams_high", "kcal_100g", "protein_100g", "carbs_100g", "fat_100g", "assumptions"],
        properties: {
          name: { type: "string" },
          amount: { type: "string" },
          grams: { type: "number" },
          grams_low: { type: "number" },
          grams_high: { type: "number" },
          kcal_100g: { type: "number" },
          protein_100g: { type: "number" },
          carbs_100g: { type: "number" },
          fat_100g: { type: "number" },
          assumptions: { type: "array", items: { type: "string" } },
        },
      },
    },
    confidence: { type: "string", enum: ["高", "中", "低"] },
    note: { type: "string" },
  },
};

const COACH_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["summary", "suggestions"],
  properties: {
    summary: { type: "string" },
    suggestions: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["type", "title", "reason", "kcal", "protein", "carbs", "fat", "day", "exercise", "week", "value"],
        properties: {
          type: { type: "string", enum: ["targets", "plan_cell", "advice"] },
          title: { type: "string" },
          reason: { type: "string" },
          kcal: { type: ["integer", "null"] },
          protein: { type: ["integer", "null"] },
          carbs: { type: ["integer", "null"] },
          fat: { type: ["integer", "null"] },
          day: { type: ["string", "null"] },
          exercise: { type: ["string", "null"] },
          week: { type: ["integer", "null"] },
          value: { type: ["string", "null"] },
        },
      },
    },
  },
};

async function client() {
  const apiKey = getKey();
  if (!apiKey) throw Object.assign(new Error("还没有填 API key"), { code: "no_key" });
  const Anthropic = await loadSdk();
  return new Anthropic({ apiKey, dangerouslyAllowBrowser: true, maxRetries: 0 });
}

const sleep = (ms, signal) => new Promise((resolve, reject) => {
  const t = setTimeout(resolve, ms);
  signal?.addEventListener("abort", () => { clearTimeout(t); reject(signal.reason); }, { once: true });
});
// No status means the request never got an answer (dropped connection, timeout).
const transient = (e) => e && (e.status == null || e.status === 429 || e.status === 529 || (e.status >= 500 && e.status < 600));

// One request with up to three retries (1 s, 2 s, 4 s) on overload, rate limit or a dropped connection.
async function send(params, { signal, onRetry } = {}) {
  const c = await client();
  for (let attempt = 0; ; attempt++) {
    try {
      if (params.model === "claude-haiku-5-5") return await c.messages.create(params, { signal });
      // Route around a classifier refusal to another model instead of failing.
      return await c.beta.messages.create({ ...params, betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" }, { signal });
    } catch (e) {
      if (signal?.aborted || attempt >= 3 || !transient(e)) throw e;
      onRetry?.(attempt + 1);
      await sleep(1000 * 2 ** attempt, signal);
    }
  }
}

function parseJson(res) {
  if (res.stop_reason === "refusal") throw Object.assign(new Error("Claude 拒绝了这次请求，换一张照片或用文字描述试试"), { code: "refusal" });
  if (res.stop_reason === "max_tokens") throw Object.assign(new Error("回答太长被截断了，再试一次"), { code: "truncated" });
  const text = res.content.filter((b) => b.type === "text").map((b) => b.text).join("");
  try { return JSON.parse(text); }
  catch { throw Object.assign(new Error("这次回答格式不对，再点一次试试"), { code: "invalid_json" }); }
}

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(",")[1]);
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}

const RULES = `要求：
- 按中国常见做法估算。烹调用油、酱汁、沙拉酱单独列一项（例如「烹调油 10 g」），方便用户改克数。
- 复合食物拆成组成部分（汉堡 → 面包、肉饼、芝士），不要整个算一项。
- grams 是最可能的克数，grams_low 和 grams_high 是合理范围；amount 用常见单位写份量（1 碗、2 个）。
- kcal_100g、protein_100g、carbs_100g、fat_100g 是这样东西每 100 克的营养，按食物成分表常见值填。
- assumptions 用很短的中文写你做的假设，每条一句，例如「按 1 勺油算」「米饭按 1 平碗」；没有就给空数组。
- confidence 写你对整体估算的把握（高、中、低），note 用一句中文说明最不确定的地方。
- 如果没有食物，items 返回空数组并在 note 里说明。`;

function mealPrompt(mode, hint) {
  return `你是注册营养师，帮一位在做力量训练的用户记录饮食。${mode === "photo" ? "请看照片（可能有几张，是同一餐的不同角度或不同的菜），识别每一样食物并估算份量。" : "根据下面的描述估算每一样食物。"}
用户的补充说明：${hint || "无"}
${RULES}`;
}

// Returns {items:[{name,amount,grams,grams_low,grams_high,kcal_100g,protein_100g,carbs_100g,fat_100g,assumptions}], confidence, note}
export async function estimateMeal({ mode, hint, images = [], signal, onRetry }) {
  const content = [];
  if (mode === "photo") {
    for (const img of images) content.push({ type: "image", source: { type: "base64", media_type: "image/jpeg", data: await blobToBase64(img) } });
  }
  content.push({ type: "text", text: mealPrompt(mode, hint) });
  const res = await send({
    model: getModel(),
    max_tokens: 6000,
    output_config: { effort: "low", format: { type: "json_schema", schema: MEAL_SCHEMA } },
    messages: [{ role: "user", content }],
  }, { signal, onRetry });
  return parseJson(res);
}

// "Fix result": change only what the user's sentence mentions and return the whole list again.
export async function fixMeal({ items, instruction, signal, onRetry }) {
  const text = `你是注册营养师。下面是一餐已经估算好的食物（JSON），用户说有地方不对。
只改用户提到的食物或数字；用户没提到的食物原样保留（名称、克数、每 100 克营养都不变）。需要时可以加一项或删一项。
当前结果：${JSON.stringify(items)}
用户的修正：${instruction}
${RULES}`;
  const res = await send({
    model: getModel(),
    max_tokens: 6000,
    output_config: { effort: "low", format: { type: "json_schema", schema: MEAL_SCHEMA } },
    messages: [{ role: "user", content: text }],
  }, { signal, onRetry });
  return parseJson(res);
}

// Weekly review. `context` is a plain-text digest of targets, plan, meals, weights and workouts.
export async function coachReview({ context, question, signal, onRetry }) {
  const text = `你是一位力量训练教练兼营养师，在看一位学员最近几周的记录。重量单位是 lb，体重单位是 kg。
${context}

学员的问题：${question || "这周哪里该调整？"}

请回答：
- summary：用几句中文直接回答问题，说出你看到的关键情况（饮食是否达标、体重趋势、训练是否在进步或停滞、睡眠疲劳）。
- suggestions：最多 5 条具体建议。每条都要学员确认才会生效，所以要具体到可以直接执行：
  - type=targets：改每日目标。kcal、protein、carbs、fat 填建议的新目标（整数，克），其他字段填 null。
  - type=plan_cell：改训练计划里某一格。day 填训练日名称、exercise 填动作名称（都要和计划里的写法完全一致），week 填第几周，value 填新的格子内容（格式同计划，例如「4×6 @85」）。营养字段填 null。
  - type=advice：其他建议（作息、动作、饮食习惯），只写 title 和 reason，其余填 null。
  - title 一句话说要做什么，reason 一句话说依据（引用记录里的数字）。
- 记录太少就直说，不要编造数字。`;
  const res = await send({
    model: getModel(),
    max_tokens: 12000,
    output_config: { effort: "medium", format: { type: "json_schema", schema: COACH_SCHEMA } },
    messages: [{ role: "user", content: text }],
  }, { signal, onRetry });
  return parseJson(res);
}

export async function testKey() {
  const res = await (await client()).messages.create({
    model: "claude-haiku-5-5",
    max_tokens: 16,
    output_config: { effort: "low" },
    messages: [{ role: "user", content: "Reply with OK." }],
  });
  return res.content.some((b) => b.type === "text");
}

export function describeError(e) {
  if (!e) return "请稍后再试";
  if (e.code === "no_key") return "先到「设置」填 Anthropic API key，才能用 Claude。也可以手动填写。";
  if (e.code) return e.message;
  const s = e.status;
  if (s === 401) return "API key 无效，请到「设置」检查。";
  if (s === 403) return "这个 API key 没有权限，请到 Anthropic 控制台检查。";
  if (s === 400 && /credit|balance/i.test(e.message || "")) return "API 账户余额不足，请到 Anthropic 控制台充值。";
  if (s === 429) return "请求太频繁或额度用完了，重试了 3 次还不行，稍等一会儿再点「重试」。";
  if (s === 529 || (s >= 500 && s < 600)) return "Claude 服务繁忙，重试了 3 次还不行，稍后再点「重试」。";
  if (e.name === "APIConnectionError" || /fetch|network/i.test(e.message || "")) return "连不上 Claude，检查一下网络后点「重试」。";
  return "失败了：" + (e.message || "请稍后再试");
}
