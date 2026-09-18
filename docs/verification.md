# 验证记录

这份文档记录**跑过什么、看到了什么**，以及每一层验证各自能证明什么、不能证明什么。
所有命令都在本机（Windows 11 / Node 24.14.0 / DSH Desktop Beta 2.0.11-beta.1）实跑通过。

## 四层验证

| 命令 | 规模 | 它证明什么 |
|---|---|---|
| `npm test` | 67 项 | 纯逻辑与宿主端：配置校验、搜索参数、响应解析、颜色换算、代理判定、配置存储、路由分发与安全边界 |
| `npm run verify:live` | 15 项 | 真的连 wallhaven：CONNECT 隧道、搜索、缩略图落盘缓存、下载原图、随机换图 |
| `npm run verify:client` | 24 项 | 真浏览器 + 真主题 token + 真宿主端：bundle 能否被 carrier 装载、页面能否渲染、背景与 token 改写是否成立 |
| `npm run verify:gui` | 21 项 | 真 `dsh web` 实例：行是否被装载、bundle 是否被下发、设置外壳里是否真的出现这一页、壁纸是否真的铺上 |

另外 `npm run build:check` 是 CI 闸门：`lib/` 与 `src/` 必须逐字节一致。

## 一、单元与集成（`npm test`）

```
ℹ tests 67   ℹ pass 67   ℹ fail 0
```

覆盖到的、值得单独点名的用例：

- **`purity` 存不下没有 SFW 的组合**：`011` 会被改写成 `111`。API 本身接受 `011`，但插件不该持久化它。
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
生产 profile 与 43120 上的 GUI **没有任何改动**。

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

## 已知问题：生产 profile 现在装不了东西

`~/.dsh/profiles/web/package.json` 里有一条指向**已不存在的文件**的依赖：

```
"dsh-ark-plans": "file:D:/deepseek/dsh-plugin-collection/plugins/dsh-ark-plans/0.1.6-alpha.1/dsh-ark-plans-0.1.0.tgz"
```

该文件在 `dsh-plugin-collection` 退役（提交 `0ae3485`）时被删掉了，于是 `pnpm` 在解析阶段就
`ENOENT` 退出——这会让**任何** `dsh plugin --profile web add …` 失败，与本插件无关。
那个 tarball 仍在该仓库的历史里（`b545cd9`），可以用
`git -C D:\deepseek\dsh-plugin-collection show b545cd9:plugins/dsh-ark-plans/0.1.6-alpha.1/dsh-ark-plans-0.1.0.tgz`
取回并放回原路径，之后 `dsh plugin` 恢复正常。

## 没验证到的

- **NSFW / sketchy 与账号相关接口**：需要一个真实 API Key，本次没有使用。相关分支（401 的措辞、
  Key 走请求头）由单测覆盖，但没有对真实账号的端到端调用。
- **macOS / Linux**：只在 Windows 上跑过。下载目录默认值走 `os.homedir()/Pictures`。
- **非回环部署**：路由的写操作只做同源校验，没有身份认证——这是 DSH 自身的姿态，README 里已写明。
