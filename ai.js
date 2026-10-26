// Food photo / text estimation through the Claude API, called straight from the browser
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

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["items", "confidence", "note"],
  properties: {
    items: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["name", "amount", "kcal", "protein", "carbs", "fat"],
        properties: {
          name: { type: "string" },
          amount: { type: "string" },
          kcal: { type: "number" },
          protein: { type: "number" },
          carbs: { type: "number" },
          fat: { type: "number" },
        },
      },
    },
    confidence: { type: "string", enum: ["高", "中", "低"] },
    note: { type: "string" },
  },
};

async function client() {
  const apiKey = getKey();
  if (!apiKey) throw Object.assign(new Error("还没有填 API key"), { code: "no_key" });
  const Anthropic = await loadSdk();
  return new Anthropic({ apiKey, dangerouslyAllowBrowser: true, maxRetries: 1 });
}

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(",")[1]);
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}

function prompt(mode, hint) {
  return `你是注册营养师，帮一位在做力量训练的用户记录饮食。${mode === "photo" ? "请看这张食物照片，识别每一样食物并估算份量。" : "根据下面的描述估算每一样食物。"}
用户的补充说明：${hint || "无"}
要求：
- 按中国常见做法估算，包括烹调用油和酱汁。
- 份量用克或常见单位（1 碗、1 个）写清楚。
- 数字取整数；protein、carbs、fat 的单位是克。
- confidence 写你对整体估算的把握（高、中、低），note 用一句中文说明估算依据或最不确定的地方。
- 如果照片里没有食物，items 返回空数组并在 note 里说明。`;
}

// Returns {items:[{name,amount,kcal,protein,carbs,fat}], confidence, note}
export async function estimateMeal({ mode, hint, image, signal }) {
  const content = [];
  if (mode === "photo" && image) {
    content.push({ type: "image", source: { type: "base64", media_type: "image/jpeg", data: await blobToBase64(image) } });
  }
  content.push({ type: "text", text: prompt(mode, hint) });

  const model = getModel();
  const params = {
    model,
    max_tokens: 4000,
    output_config: { effort: "low", format: { type: "json_schema", schema: SCHEMA } },
    messages: [{ role: "user", content }],
  };
  let res;
  if (model === "claude-haiku-5-5") {
    res = await (await client()).messages.create(params, { signal });
  } else {
    // Route around a classifier refusal to another model instead of failing.
    res = await (await client()).beta.messages.create(
      { ...params, betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" },
      { signal },
    );
  }
  if (res.stop_reason === "refusal") throw Object.assign(new Error("Claude 拒绝了这次请求，换一张照片或用文字描述试试"), { code: "refusal" });
  if (res.stop_reason === "max_tokens") throw Object.assign(new Error("回答太长被截断了，再试一次"), { code: "truncated" });
  const text = res.content.filter((b) => b.type === "text").map((b) => b.text).join("");
  try { return JSON.parse(text); }
  catch { throw Object.assign(new Error("这次回答格式不对，再点一次试试"), { code: "invalid_json" }); }
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
  if (e.code === "no_key") return "先到「设置」填 Anthropic API key，才能识别照片。也可以手动填写。";
  if (e.code) return e.message;
  const s = e.status;
  if (s === 401) return "API key 无效，请到「设置」检查。";
  if (s === 403) return "这个 API key 没有权限，请到 Anthropic 控制台检查。";
  if (s === 400 && /credit|balance/i.test(e.message || "")) return "API 账户余额不足，请到 Anthropic 控制台充值。";
  if (s === 429) return "请求太频繁或额度用完了，稍等一会儿再试。";
  if (s === 529 || (s >= 500 && s < 600)) return "Claude 服务暂时繁忙，稍后再试。";
  if (e.name === "APIConnectionError" || /fetch|network/i.test(e.message || "")) return "连不上 Claude，检查一下网络。";
  return "估算失败：" + (e.message || "请稍后再试");
}
