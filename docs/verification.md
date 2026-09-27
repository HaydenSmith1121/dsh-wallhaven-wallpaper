# 验证记录

这份文档记录**跑过什么、看到了什么**，以及每一层验证各自能证明什么、不能证明什么。
第一至六节在 DSH Desktop Beta 2.0.11-beta.1（`@deepseek-ai/dsh` 0.1.6-alpha.1 一代）上实跑通过；
第七节是把同一套验证搬到 **DSH 桌面版 0.1.7-rc.2** 上重跑的记录，包括在那里抓到的两个真 bug。

## 四层验证

| 命令 | 规模 | 它证明什么 |
|---|---|---|
| `npm test` | 109 项 | 纯逻辑与宿主端：配置校验、搜索参数、响应解析、颜色换算与对比度、代理判定、**本机代理探测**、配置存储、路由分发与安全边界，以及**换版本才会走到的容错分支** |
| `npm run verify:live` | 15 项 | 真的连 wallhaven：CONNECT 隧道、搜索、缩略图落盘缓存、下载原图、随机换图 |
| `npm run verify:client` | 24 项 | 真浏览器 + 真主题 token + 真宿主端：bundle 能否被 carrier 装载、页面能否渲染、背景与 token 改写是否成立 |
| `npm run verify:gui` | 21 项 | 真 `dsh web` 实例：行是否被装载、bundle 是否被下发、设置外壳里是否真的出现这一页、壁纸是否真的铺上 |

另外 `npm run build:check` 是 CI 闸门：`lib/` 与 `src/` 必须逐字节一致。

## 一、单元与集成（`npm test`）

```
ℹ tests 109   ℹ pass 109   ℹ fail 0
```

其中 `test/compat.test.mjs` 是 0.1.7-rc.2 那一轮补上的 30 项，覆盖的都是**只有换版本才会
走到的分支**：只有一个 `register(ns, locale, dict)` 重载的 locale 服务、注册到一半抛异常的
字典（必须回滚已注册的那一半）、在某个席位上抛错的 slots、返回 `undefined` 的
`webServer.register`、以及主按钮在「近白底配白字」时把白色拒掉。
写这组用例时立刻抓到一个真 bug：`detectDshVersion` 里的 `ctx.get('profileContext')`
没有包 try/catch，一个会抛的 context 能让异常直接穿出 `apply()`。

覆盖到的、值得单独点名的用例：

- **`purity` 三个都能关，但不能全关**：`011` 原样存下（只搜 sketchy 是正当选择），
  `000` 会被退回 `100`（wallhaven 表达不了「一个分级都不要」，空结果看起来像「搜索坏了」）。
- **`categories` 存不下空集**：wallhaven 无法表达「一个分类都不选」，会返回空结果，看起来像「搜索坏了」。
- **图片域名白名单**：`https://w.wallhaven.cc.evil.example/x.jpg`、`https://w.wallhaven.cc@evil.example/x.jpg`、
  `http://w.wallhaven.cc/x.jpg` 全部拒绝；被拒绝时**不开 socket**（用假 transport 断言调用次数为 0）。
- **跨站写操作被拒**：`POST /config` 带 `Origin: https://evil.example` 返回 403，且代理设置没有被改写。
- **429 / 401 / DNS 失败各有各的话**：不会都变成一句「搜索失败」。
- **配置文档损坏**：改名为 `config.json.corrupt-<时间戳>` 后以默认值继续，而不是静默清空。
- **并发写不丢**：三个 `update` 同时发出，三个字段全部落盘。
- **一次写失败不毒化队列**：该次调用 reject，下一次照常成功，且内存值从未声称写过失败的那次。

## 二、真连 wallhaven（`npm run verify:live`）

这台机器的 `wallhaven.cc` 解析到 Facebook 的 IP（DNS 被污染），直连必然失败；走本机
`127.0.0.1:7897` 的 HTTP 代理则完全正常。所以这一层同时也是对**自研 CONNECT 隧道**的验证：

```
proxy in effect: http://127.0.0.1:7897
1. probe            ✔ wallhaven reachable — 900 ms
2. search           ✔ 24 results · total=185 last=8
                    ✔ 每条的 full 都在 w.wallhaven.cc，thumb 都在 th.wallhaven.cc
3. image bytes      ✔ image/jpeg · 44338 bytes
                    ✔ 第二次取同一张走磁盘缓存（不再发请求）
4. download         ✔ wallhaven-gwdvxq-3840x2160.jpg · 2686530 bytes
5. random search    ✔ 有结果，且保存的 sorting 仍是 toplist（没被改写）
```

## 三、真浏览器渲染（`npm run verify:client`）

这一层自己起一个本地服务：页面用**从已安装的 DSH 里现取**的 `--dsw-*` token 样式表，
`/plugins/dsh-wallhaven-wallpaper/*` 直连**真实的宿主端路由**（不是打桩），
`lib/client.js` 原样加载，`slots` / `locale` 用最小 mock 复刻。

它抓到过两个真 bug，都是只靠单测发现不了的：

1. **覆盖写错了元素**。DSH 把浅色 alias token 定义在 `body` 上、深色定义在 `body[data-ds-dark-theme]` 上，
   **不是 `:root`**。最初把覆盖写在 `html:root` 上，只被继承——而被继承的值永远输给主题自己写在
   `body` 上的那一条，于是**浅色下壁纸完全不透**。修法：写到 `body` 上，并用
   `html:root body[data-ds-dark-theme]` 压过深色那条（现在有单测钉住这个选择器）。
2. **主按钮文字写死白色**。`--dsw-alias-brand-primary` 在 DSH 里是**中性高对比色**（浅色近黑、
   深色近白），不是蓝色。深色主题下于是变成白底白字，按钮上的字整个消失。修法：用配对的
   `--dsw-alias-label-primary-inverted`；并加了一条**对比度断言**，浅色与深色各测一次
   （现在是 18.90:1 与 11.57:1）。

最终：

```
✔ bundle 以包名注册            ✔ 两个 slot 都被 inject
✔ apply() 未抛错               ✔ 两个界面都注册成功
✔ 页面渲染出 12 按钮 / 8 输入 / 5 下拉 / 3 滑块
✔ 主按钮文字可读（浅色 18.90:1，深色 11.57:1）
✔ 宿主端 GET /status 应答      ✔ 真搜索拿到 24 条      ✔ 缩略图真的解码出字节
✔ 动态样式表把画布 token 改成 rgba(255,255,255,0.720)、侧栏 rgba(249,250,251,0.720)、抬升面 0.900
✔ 深色下重新推导为 rgba(21,21,23,0.720)（不是留着浅色的值）
✔ 关掉后：图层移除、覆盖清空、token 回到主题自己的值
✔ 控制台无报错
```

## 四、真 `dsh web` 实例（`npm run verify:gui`）

由于生产 profile（`~/.dsh/profiles/web`）目前**无法 `pnpm install`**（见下），
这一层跑在一个**隔离的 DSH home** 上：把 `web` profile 复制到 `D:\deepseek\.tmp\wh-home`，
把插件放进它的 `node_modules` 并在 `dsh.profile.bundles` 里登记，然后在 43123 端口起一个独立实例。
生产 profile 与 43120 上的 GUI **没有任何改动**。跑完这个一次性 home 已被删除。

复现步骤（`dsh.cmd` 会硬写 `DSH_HOME`，所以必须直接调 CLI，不能用那个 shim）：

```powershell
$HOME2 = 'D:\deepseek\.tmp\wh-home'
robocopy "$env:USERPROFILE\.dsh\profiles\web" "$HOME2\profiles\wh-verify" /E /MT:8
Remove-Item -Recurse -Force "$HOME2\profiles\wh-verify\.dsh-module-fallback"   # robocopy 会把符号链接摊平，让 dsh 自己重建
Copy-Item "$env:USERPROFILE\.dsh\settings.yaml" "$HOME2\settings.yaml"
# 解开 tarball 到 wh-verify\node_modules\dsh-wallhaven-wallpaper，
# 再把 "dsh-wallhaven-wallpaper" 加进该 profile 的 dependencies 与 dsh.profile.bundles

$env:ELECTRON_RUN_AS_NODE = '1'
$env:DSH_HOME = $HOME2
& 'C:\...\DSH Desktop Beta.exe' --expose-internals 'C:\...\resources\app\lib\desktop-cli.js' `
    --profile wh-verify --port 43123 --no-open

# 另开一个带 CDP 端口的 Chrome，然后：
node scripts/verify-gui.mjs --home $HOME2 --origin http://127.0.0.1:43123
```

`verify-gui.mjs` 自己从该实例的 `.credentials.yaml` 里派生浏览器会话 cookie
（密钥是 base64url，**要先解码成 32 字节**再当 HMAC key 用；直接拿文本签名会得到一个格式正确
但永远被拒的 cookie——这一步踩过）。

```
1. 宿主半真的被装载了
   ✔ GET /plugins/dsh-wallhaven-wallpaper/status → 200
   ✔ 配置路径 D:\deepseek\.tmp\wh-home\storages\dsh-wallhaven-wallpaper\config.json
   ✔ 解析出下载目录 C:\Users\Administrator\Pictures\DSH Wallpapers

2. 客户端 bundle 真的到达了页面
   ✔ 模块 carrier 下发了本包的 bundle（网络日志）

3. 设置外壳里真的出现了这一页
   ✔ 侧边栏导航出现「壁纸」；点击后标题、搜索、外观、访问四组控件全部渲染

4. 在真 GUI 里真搜了一次
   ✔ 25 张缩略图渲染，25 张全部解码出字节

5. 在真外壳里铺上
   ✔ 图层出现在真实文档里，指向本插件的图片路由
   ✔ 画布 token → rgba(255,255,255,0.720)，侧栏 → rgba(249,250,251,0.720)

6. 关掉之后外壳回到原样
   ✔ 图层移除，token 回到 #fff

7. 控制台无报错
```

截图见 `docs/settings.png`（真实 GUI，真实壁纸，真实搜索）。

## 五、装进生产 profile（3080）

生产环境是 `DSH_HOME=~/.dsh`、profile `web`、端口 **3080**。装法就是文档里那一条：

```bash
dsh plugin --profile web add github:HaydenSmith1121/dsh-wallhaven-wallpaper
```

装之前先修好了一个与本插件无关、但会挡住**任何**安装的问题（见下一节）：该 profile 里有四条
`file:` 依赖指向被删掉的 tarball，`pnpm` 在解析阶段就 `ENOENT`。

四步校验（③④ 来自你仓库的安装说明）：

| # | 命令 | 结果 |
|---|---|---|
| ② | 依赖与 bundles | 已写入 `dependencies` 与 `dsh.profile.bundles` |
| ③ | `dsh --profile web --dump-config` | 末行 `# == dsh-wallhaven-wallpaper`，内含 `id: wallhaven-wallpaper / name: dsh-wallhaven-wallpaper` |
| ④ | `dsh web --port 3081 --no-open` | 输出**只有一行** `dsh web: http://127.0.0.1:3081/?token=…`，无 `plugin tree failed to load` / `does not provide an export` / `Cannot find module` |

第 ④ 步刻意用 **3081** 而不是重启 3080：3080 正在托管发起这次工作的那个会话，
重启它会中断当前回合。同一个 home、同一个 profile、另一个端口，验证的是同一棵树。

`verify-gui.mjs` 随后针对 3081 跑满 21 项，全过（页面里能看到真实会话列表与真实壁纸）。
一个附带结论：检查「控制台无报错」要按**归属**过滤而不是按数量 —— 页面上
`dsh-workbuddy-connect` 的 `WorkBuddyProbeControl` 会抛
`Cannot read properties of null (reading 'provider')`，那与本插件无关；脚本现在把这类报错单列出来。

### 看图才发现的三个问题

前面几层都没抓到，是在**真实 GUI 的截图**里看出来的：

1. **侧边栏「换一张」折成两行**。那个席位给的宽度很小，按钮又固定 28px 宽。
   宽栏改成自适应 + `nowrap`，窄栏仍是 28px 的 ↻。
2. **默认不透明度偏保守**。默认 `0.72` 在浅色主题下几乎看不出壁纸；想看效果要调到 0.35–0.5。
   默认值保留（可读性优先），但这个旋钮的位置值得知道。
3. **背景图层两处无谓开销**：默认模糊为 0 时，`will-change: filter` 把一个整屏元素提升成独立
   合成层，`inset: -64px` 又让绘制面积比视口大 ~20%。改成按需：只有真的开了模糊才外扩。

### 无头浏览器的栅格化假象（记下来，免得下次再查一遍）

无头 Chrome 截图时，背景图层经常只被栅格化出**一部分**（有时顶部 575px，有时只有 35px，
每次重绘会长一点），看起来像「壁纸没铺满」。但同一页面的 DOM 全是正常的：
图层 `1600×1000`、`position:fixed`、`z-index:-1`、`opacity:1`、
`--dsw-alias-bg-base` 已是 `rgba(255,255,255,0.34)`、控制台无报错。

**在真实（有头、GPU 渲染）浏览器里打开同一个地址，壁纸铺满整个窗口。**

所以本项目的截图数据不能当作「有没有画出来」的判据：断言几何、计算样式、token 值都可以，
唯独**像素覆盖**要靠人眼或真实浏览器。

## 六、修好的那条 `file:` 断链

`~/.dsh/profiles/web/package.json` 里有四条依赖指向**已不存在的文件**（都指向退役的
`dsh-plugin-collection`）：`dsh-ark-plans`、`dsh-excel-viewer`、`dsh-opencode-go-plus`、
`dsh-session-cleanup`。它们在 `dsh-plugin-collection` 退役（提交 `0ae3485`）时被删掉，
于是 `pnpm` 在解析阶段就 `ENOENT` 退出——这会让**任何** `dsh plugin --profile web add …` 失败。

这四个文件仍在该仓库历史里（`0ae3485^`），已用 `git archive` 原样取回原路径：
**没有改动任何依赖规格，也没有改动任何已装插件的版本。**

> 没有走「迁移到各自仓库的 `github:` 规格」这条路，因为 `dsh-ark-plans` 的仓库已经是
> **0.2.0** 而本机装的是 **0.1.0**：那样会顺带升级一个正在正常工作的插件，超出「装一个插件」的范围。
> 想迁移的话是一次独立的、需要单独验证的操作。
>
> 取回时用了 `git archive --output=<file>` 而不是 `git show … > file`：
> 后者会让二进制经过 PowerShell 的文本管线，tarball 会被破坏。

profile 的五个状态文件（`package.json` / `pnpm-lock.yaml` / `pnpm-workspace.yaml` /
`cordis.patch.yml` / `cordis.yml`）在动手前已备份到
`$DSH_HOME/storages/dsh-plugins-market/backups/wallhaven-install-<时间戳>/`。

## 七、换到 DSH 桌面版 0.1.7-rc.2

这一轮不是「再跑一遍」，而是**把插件装到一个它没见过的 Harness 上**。本机的
`D:\install\Harness` 是 `@deepseek-ai/dsh-desktop` / `dsh-desktop-runtime` **0.1.7-rc.2**
（`dshBuildCommit c1275515`），比写这个插件时的 `0.1.6-alpha.1` 晚一代。

### 先做的事：把 0.1.7-rc.2 的接口面读出来

不猜，直接从装好的运行时里读：

```powershell
# app.asar 里的 @deepseek-ai/* 全量解出来（284 个包，约 54 MB，跳过 libreoffice）
node _wh_extract.cjs D:\...\_wh_dsh
```

再对着**正在跑的**实例核对（DSH 自带的 Inspect 接口，比读源码更权威）：

| 接口 | 0.1.7-rc.2 上的结论 |
|---|---|
| `settings.section` / `sidebar.footer.action` | 都还在，都是 `list` 席位，`replaceRisk: none`，注册字段仍是 `id`/`order`/`label` |
| `locale.register(ns, dicts)` / `bind(ns)` | 都在（另有 `register(ns, locale, dict)` 重载） |
| `theme/change` | 还在；客户端事件一共只有 4 个 |
| `webServer.register({kind:'prefix'})` | 签名未变；重复 `(kind, path)` 仍然抛错 |
| `dsh.client` + `exports["./client"]` | 仍是客户端半的发现路径；`dsh.client.external` 才会建图边，`inject` 只是信息性的 |
| `--dsw-alias-*` token | 14 个 alias token 全在；`--dsw-alias-label-primary-inverted` **不在公布的表里但确实存在** |
| `dsh.manifestVersion` | **全仓库零处引用**——已经没有任何代码读它 |

结论：这个插件用到的接口在 0.1.7-rc.2 上**一个都没变**。所以「适配新版本」这件事不是修一个
调用，而是让插件在接口*真的*变了的那天还能活下来——也就是这一轮加的能力探测层。

### 隔离实例怎么起的

不碰生产 profile。用 `DSH_HOME` 指向一个一次性 home，profile 里只放两个官方 bundle 加本插件，
插件用 **junction** 链到仓库（这样改完 `lib/` 直接生效，不需要 `pnpm install`）：

```powershell
New-Item -ItemType Directory -Force "$T\profiles\whv\node_modules"
# package.json: bundles = [dsh-base, dsh-web-app, dsh-wallhaven-wallpaper]
cmd /c mklink /J "$T\profiles\whv\node_modules\dsh-wallhaven-wallpaper" <仓库路径>

$env:ELECTRON_RUN_AS_NODE='1'; $env:DSH_HOME=$T
& 'D:\install\Harness\DeepSeek Harness.exe' `
  'D:\install\Harness\resources\app.asar\dsh\node_modules\@deepseek-ai\dsh\lib\bin.js' `
  --profile whv --port 43992 --no-open
```

两个坑：`Set-Content -Encoding utf8` 会写 BOM，`JSON.parse` 直接死在第一个字符上
（要用 `[System.IO.File]::WriteAllText` + `UTF8Encoding($false)`）；
`--dump-config` 是最好的第一道闸门，它证明 loader 行确实进了合成树。

### 结果

```
GET /plugins/dsh-wallhaven-wallpaper/compat
{"ok":true,"dshVersion":"0.1.7-rc.2","dshVersionStatus":"verified",
 "dshVersionSource":"filesystem","profile":"whv","node":"24.18.1","platform":"win32",
 "routes":{"ok":true,"mode":"disposer","error":""}}
```

浏览器侧（Chrome 153 headless + 裸 CDP，本机 playwright 已被移除，用 Node 自带的
`WebSocket` 直连 `--remote-debugging-port`）：

```
OK  sidebar.footer.action seat rendered — 换一张
OK  plugin nav entry present in the settings shell — … | 通用设置 | 模型 | 内置插件 | Agent 预设 | 壁纸 | …
OK  page renders "兼容性"
OK  compatibility row "宿主路由" / "设置页席位" / "侧边栏席位" / "文案字典" / "主题 token" / "背景图层"
OK  compatibility verdict rendered — 本插件需要的接口都在。
OK  primary button found and coloured — {"color":"rgb(255,255,255)","background":"rgb(15,17,21)"}
OK  no console errors
```

### 抓到的两个真 bug

**① 主题切换晚一拍 → 浅色下壁纸完全透不出来。**

`theme/change` 在 shell 把 `data-ds-dark-theme` 写到 `body` **之前**触发。于是：

| DOM 实际配色 | 插件写的覆盖选择器 | 后果 |
|---|---|---|
| 深色 | `html:root body`（浅色那条） | 浅色推导出的 `rgba(255,255,255,.72)` 压过了深色主题 → 发灰发白 |
| 浅色 | `html:root body[data-ds-dark-theme]` | 那条规则不匹配，画布 token 保持主题的不透明值 → **壁纸一点都透不出来** |

每次切换都恰好差一拍，可复现：

```
boot (dark):  {"dark":true,  "bgBase":"rgba(255, 255, 255, 0.720)", "overrideSelector":"light"}
after light:  {"dark":false, "bgBase":"#fff",                      "overrideSelector":"dark"}
after dark:   {"dark":true,  "bgBase":"rgba(255, 255, 255, 0.720)", "overrideSelector":"light"}
```

修法不是「延迟一下再读」——那只是把竞态换个地方。改成**观察那个属性本身**：
`MutationObserver` 盯 `documentElement` 的 `data-ds-dark-theme`（`subtree` 让它在 `<body>`
出现之前就能挂上，`attributeFilter` 保证别的属性动不了它），回调必然发生在属性落地**之后**。
修完：

```
after light:  {"dark":false, "bgBase":"rgba(255, 255, 255, 0.720)", "sidebar":"rgba(249, 250, 251, 0.720)"}
after dark:   {"dark":true,  "bgBase":"rgba(21, 21, 23, 0.720)",    "sidebar":"rgba(27, 27, 28, 0.720)"}
after light:  {"dark":false, "bgBase":"rgba(255, 255, 255, 0.720)"}
```

**② 主按钮文字在深色下不可读（1.05:1）。**

改这个插件时本来想把 `--dsw-alias-label-primary-inverted` 换成「JS 算出来的对比度颜色」，
理由是那个 token 不在 DSH 公布的 token 表里、未来可能消失。第一版就是这么写的：
JS 读一次主题、算一次、写成 `--dsh-wh-on-brand`。结果深色下白字配近白底，
**1.05:1，等于看不见**——因为 JS 那次读取拿到了浅色的值。

真正的修法是把「实时性」还给 CSS：

```css
html:root, html:root body {
  --dsh-wh-on-brand: var(--dsw-alias-label-primary-inverted, <按对比度算出的兜底>);
}
```

主题的 token 存在时由 **CSS 在绘制时**解析（不存在过期问题），不存在时才用 JS 算的兜底。
声明在 `body` 上而不是 `:root`，理由和表面 token 那条一样：`var()` 只在**声明它的那个元素**
上取到实时值。修完实测：

```
light: brand=#0f1115  →  color rgb(255,255,255) on rgb(15,17,21)   = 18.90:1
dark:  brand=#f9fafb  →  color rgb(53,54,56)   on rgb(249,250,251) = 11.57:1
```

> 两个 bug 都是「只在真实 GUI 里、真实切一次主题」才看得见的。
> 单测、`build:check`、`--dump-config` 全都不会报。

## 八、连通性优先 + SFW 可关（来自真实使用反馈）

真实使用里报了两个问题：**wallhaven 总是连不上**（截图里两次「请求超时（20000ms）」），
以及 **SFW 关不掉**。查下来第一条的根因不在网络：

```
Get-NetTCPConnection -State Listen | Where LocalPort -in 7890,7897,...
  → 127.0.0.1:7897   verge-mihomo
$env:HTTPS_PROXY → （空）
```

机器上跑着 mihomo，但 DSH 是从图形界面启动的，**没有继承 `HTTPS_PROXY`**；插件于是直连一个
被污染的 DNS，20 秒后超时。所以这一轮做的不是「把超时调短」，而是**让插件自己找到那条出路**。

### 连通性测试现在会做什么

1. 先测当前路由（**8 秒**预算，不是 20 —— 一个要 20 秒才说「不行」的测试不是测试）。
2. 当前路由是空（既没填也没环境变量）且失败时，扫本机常见 HTTP 代理端口。
   扫描**先做 TCP connect**（400 ms，并发），只对真的在监听的端口发真实 API 请求，
   所以「没有代理」这种情况几百毫秒就结束，而不是每个端口等一次超时。
3. 找到能通的那条，连同它一起报给页面，页面给一个「使用」按钮。

真实实例上的输出（无 `HTTPS_PROXY`，mihomo 在 7897）：

```
GET /status?diagnose=1                     耗时 6.1 s（其中 ~5 s 是直连那次失败）
{"probe":{"ok":false, ... "source":"discovered",
          "discovered":"http://127.0.0.1:7897",
          "discovery":{"proxy":"http://127.0.0.1:7897","latencyMs":1013,"total":625641},
          "candidates":[{"proxy":"http://127.0.0.1:7897","ok":true,"latencyMs":1013}]}}
```

点一下「使用」之后再搜，**0.5 s 返回 24 张**；`purity=011` 的搜索返回的 `purity` 全是 `sketchy`
——证明 SFW 是真的没发出去，而不是界面上的样子。

### 浏览器里逐条验的（Chrome 153 headless + 裸 CDP）

```
OK  discovered proxy is offered — 检测到本机代理可用：http://127.0.0.1:7897 · 668 ms
OK  the failure is stated, not hidden
OK  search is skipped with an actionable message — 5815 ms      ← 原来要等 20 s 再报同一句话
OK  the offer is clickable
OK  status turns reachable — wallhaven 可达 · 650 ms
OK  thumbnails rendered — 24 images
OK  SFW is enabled / SFW can be turned off / the other chip stayed on
OK  the host stored SFW off — 010
OK  at least one purity stays on
OK  the refusal is explained, not silent
OK  no console errors
```

### 这一轮抓到的 bug：`diagnose` 把「找到的」当成「在用的」

第一版 `diagnose()` 在发现可用代理后，直接把**赢家**的结果当成主字段返回：

```js
return { ...winner, source: 'discovered', ... };   // ← ok:true, proxy:'http://127.0.0.1:7897'
```

于是状态行显示「wallhaven 可达」，而实际配置仍然是直连；更糟的是搜索闸门读到 `probe.ok === true`
直接放行，搜索又走那条死路由，**又挂了 20 秒**。浏览器验证里一次就露出来了：

```
FAIL  the failure is stated, not hidden
FAIL  search is skipped with an actionable message — 30227 ms
```

修法是把主字段永远留给**当前路由**：「我配的这条通不通」才是状态行要回答、搜索闸门要判断的问题，
而一个只是被找到的代理还没有生效。找到的那条单独放在 `discovered` / `discovery` 里：

```js
return { ...first, source: 'discovered', discovered: winner.proxy,
         discovery: { proxy: winner.proxy, latencyMs: winner.latencyMs } };
```

> 单测当时是**绿的** —— 因为它断言的就是那个错误契约（`result.ok === true`）。
> 是我照着实现写测试，而不是照着「这个字段是什么意思」写测试。改完契约后单测也一并改了。

## 没验证到的

- **NSFW / sketchy 与账号相关接口**：需要一个真实 API Key，本次没有使用。相关分支（401 的措辞、
  Key 走请求头）由单测覆盖，但没有对真实账号的端到端调用。
- **macOS / Linux**：只在 Windows 上跑过。下载目录默认值走 `os.homedir()/Pictures`。
- **非回环部署**：路由的写操作只做同源校验，没有身份认证——这是 DSH 自身的姿态，README 里已写明。
- **`0.1.6-alpha.1` 之外的旧版本**：容错分支有单测，但没有把插件真的装到那些版本上跑过。
  能力探测层的作用正是让这种情况**可诊断**（兼容性面板会列出缺哪一块），而不是保证它一定能用。
- **wallhaven 真实取图（第七节）**：那一轮的隔离实例没有配代理，所以只验证了 token 改写与图层挂载，
  图片本身是 502。真实取图由第二节（`verify:live`）和第八节（走 mihomo 的 24 张缩略图）覆盖。
- **自动探测的端口表**：只覆盖了常见客户端的默认 HTTP 端口。非默认端口、或只开 SOCKS 的客户端，
  仍然要手填 —— 探测失败时页面会说「本机常见代理端口都没有应答」，而不是假装找过了。
