# 训练饮食本 fitlog

在手机上记录训练和饮食的网页应用。可以「添加到主屏幕」，像 App 一样打开，离线也能记录。

- **饮食**：拍照或选一张食物照片，Claude 会估算每样食物的份量、热量、蛋白质、碳水和脂肪，你确认或修改后保存。也可以用文字描述，或者手动填写。
- **今日**：对照每日目标，看热量和三大营养素吃够没有、还差多少，并显示最近 7 天的柱状图。
- **训练**：选今天练哪一天、第几周，应用会按计划预填组数、次数和目标重量（单位 lb）。每组记实际重量、次数和 RIR，同一个动作会显示上一次的成绩。
- **计划**：按周填写一个 block 的计划表，也可以载入 2026 年 11 月的示例 block。
- **设置**：根据身高、体重、年龄和目标，算出每日热量和三大营养素目标；填写 API key；导出和导入备份。

## 数据保存在哪里

所有记录都存在当前设备浏览器的 IndexedDB 里，不会上传到任何服务器。换手机或清除浏览器数据之前，请先在「设置」里导出备份（JSON 文件），之后在新设备上导入即可恢复。

## 照片识别

照片识别是直接从浏览器调用 Claude API，需要你自己的 Anthropic API key：

1. 打开 [console.anthropic.com](https://console.anthropic.com/settings/keys)，创建一个 API key，并充值少量额度。
2. 在应用的「设置 → 照片识别」里粘贴 key，然后点「测试连接」。

key 只保存在这台设备的浏览器里，只会发给 `api.anthropic.com`。默认模型是 Claude Opus 5.5，可以在设置里换成更便宜的 Sonnet 5.5 或 Haiku 5.5。

## 部署（Cloudflare Workers）

仓库里的 `wrangler.jsonc` 会把整个目录当作静态文件发布（不运行 Worker 脚本）。静态文件请求在免费版也不限次数，不计入每天 10 万次的 Worker 请求额度。`.assetsignore` 列出了不需要发布的文件。

1. 登录 [dash.cloudflare.com](https://dash.cloudflare.com)，进入 **Workers & Pages**，点 **Create**，选 **Import a repository**（连接 GitHub）。
2. 选择 `YANLING-H/fitlog` 仓库。项目名填 `fitlog`，Build command 留空，Deploy command 保持默认的 `npx wrangler deploy`。
3. 点 **Deploy**。完成后网址是 `https://fitlog.<你的子域>.workers.dev`，也可以在 Settings → Domains & Routes 绑定自己的域名。

之后每次 `main` 有更新都会自动重新部署。

在手机上打开这个网址后：
- iPhone（Safari）：点分享按钮，选「添加到主屏幕」。
- Android（Chrome）：打开菜单，选「添加到主屏幕」或「安装应用」。

也可以用 GitHub Pages：在 Settings → Pages 里选择 `main` / `(root)`。

## 本地运行

不需要构建，任何静态文件服务器都可以：

```sh
python3 -m http.server 8000
# 然后打开 http://localhost:8000
```

## 文件

| 文件 | 作用 |
| --- | --- |
| `index.html`、`style.css` | 页面结构和样式 |
| `app.js` | 页面逻辑：今日、饮食、训练、计划、设置 |
| `db.js` | IndexedDB 存储 |
| `ai.js` | 调用 Claude API 估算饮食 |
| `vendor/anthropic-sdk.mjs` | 打包好的官方 Anthropic TypeScript SDK（0.133.0），可以用 `scripts/build-sdk.sh` 重新生成 |
| `sw.js`、`manifest.webmanifest`、`icons/` | 离线缓存，以及「添加到主屏幕」 |
| `examples/nov-2026-block.json` | 示例训练计划 |
