# cortico-world-cua（省 token 版 · HY-pt fork）

> 这是 [Phantivia/cortico-world-cua](https://github.com/Phantivia/cortico-world-cua) 的一个**改造分支**，给 Coopanion / Cortico 的「操作电脑」能力加上**本地 OCR 拦截**，大幅降低截图带来的云端 token 开销。原版的电脑操作、让位、权限逻辑全部保留。

## 一句话介绍

装了这个分支，**桌宠操作电脑时默认不再把整张高清截图发给云端**，而是在你本机用系统自带的 OCR 把屏幕转成「文字 + 坐标」交给模型。只有在看不清（屏幕上几乎没有文字）时，才把一张小图发给 Coopanion 已经配好的视觉模型——**你不用在插件里再填一遍 Key**。

## 它能省多少

- 典型「操作电脑」场景（文字界面为主）：**视觉相关的 token 开销可降约 90%**，整张账单预计下降 **55%–70%**。
- 推算依据与实测方法见文末。

## 它是怎么省 token 的

原版 CUA 每轮都把整张缩放截图（JPEG）作为图片附件回给云端。截图每帧都在变，导致云端提示词缓存被击穿，账单里很少的「未命中输入」却占了大部分费用，而且图片 token 本身很贵。

本分支在 `cua_screenshot` 这条链路上做了拦截，优先级如下：

1. **本机 OCR（默认，最省）**：截图后在你的电脑上用**系统内置 OCR**（Windows 的 WinRT OCR / macOS 的 tesseract）把可见文字和坐标提取出来，只把**文字 + 截图像素坐标**返回给模型，高清大图不上云。点击直接用返回的坐标，模型无需"看图"。
2. **视觉兜底（仅在 OCR 彻底失败时）**：当屏幕上一行字都没有（比如纯图表、图片、视频帧），本地 OCR 取不到内容，才把截图交回 **Coopanion 已经配置好的视觉 API** 去"看"。这一步：
   - **复用你在 Coopanion 里填好的 Provider / Key**，插件不要求再填一遍；
   - **两级截图**：先围绕"上一次操作的坐标"裁剪一小块发过去（省 token），裁剪太小或没有坐标时才退回全屏。
3. **纯文字兜底**：连视觉兜底都关掉时，只返回一行提示文字，绝对不发图。

> 想强制让模型看原图（调试、或确实要识别图形）：调用 `cua_screenshot({ forceImage: true })` 即可绕过 OCR 直接拿截图。

**全程不依赖、不下载任何"视觉小模型"**——OCR 是你操作系统自带的能力。

## 安装（给使用者）

> 前提：你已经装好并登录 Coopanion / Cortico，且「操作电脑（cua）」本来就能用。本分支只是把它的截图逻辑换成更省钱的版本。

1. 拿到本分支代码：
   - 方式一：`git clone https://github.com/HY-pt/cortico-world-cua.git`
   - 方式二：直接下载仓库 ZIP 并解压，记住解压后的**绝对路径**。
2. 打开 Coopanion / Cortico 的 **「扩展」页 → 手动安装**，在输入框里填**上面那个绝对路径**（link 模式），确认安装。
3. **整进程重启** Coopanion / Cortico。
4. 在 **「World 总览」** 里启用 `cua`（电脑操作）；或在 bot 的 `declares` 里加上 `cua`。
5. 无需在插件里填任何视觉 Key——直接复用你 Coopanion 已配的 Provider。

> **安装时会看到的两条提示（都正常）**
> - 扩展页可能提示「按 world 契约 v5 编写，本框架是 v6」——这是**正常的**，原版 cua 也是 v5，框架经过渡层加载，功能不受影响。
> - 若安装报 pnpm / corepack 错误（例如 `Cannot find module ...pnpm.cjs`），是 corepack 缓存坏了：先 `corepack disable pnpm`，再 `npm i -g pnpm@11`（或修好 corepack）后重试。

装好后正常使用即可：让 Coo「看一眼屏幕」「点一下某按钮」，你会发现它的回复里 `cua_screenshot` 返回的是文字和坐标，而不再是图片。

## 配置（可选）

在 World 配置页的 `worlds.cua.vision.*` 下：

| 配置项 | 默认 | 说明 | 建议 |
|---|---|---|---|
| `vision.ocr` | `true` | 本机 OCR 拦截：截图转文字、不传图，最省 token | 保持开启 |
| `vision.fallback` | `true` | OCR 失败时，借 Coopanion 已配视觉 API 发图（两级截图）；关掉则纯本地、永不传图 | 想"绝不传图"就关掉 |
| `vision.cropPadding` | `0.2` | 兜底局部裁剪相对上次坐标的归一化边距；越小越省 token，太大则省得少 | 一般不用改 |
| `vision.ocrLang` | `''` | OCR 语言：Windows 填 WinRT 码（如 `zh-Hans`），macOS 填 tesseract 码（如 `chi_sim`）；留空时 Windows 跟随系统、macOS 用英文 | 中文识别不准时填 `zh-Hans`（Win）/ `chi_sim`（Mac） |

> 想做到**绝对零图片上传**（最省、最隐私）：把 `vision.fallback` 设成 `false`。此时只有在屏幕有文字时才能"看"，纯图形界面会退回文字提示——但 token 开销最低。

## 工具一览

坐标一律是最近一张截图的像素；截图缩放到 `screenshot.maxWidth`×`maxHeight`（默认 1280×800）以内，画上鼠标指针。

| 工具 | 作用 |
|---|---|
| `cua_screenshot(forceImage?)` | 截主屏幕。**默认用本机原生 OCR 把屏幕转成文字 + 坐标返回，不向云端传图（省 token）**；只有 OCR 取不到文字时才借 Coopanion 已配视觉 API 发图。传 `forceImage: true` 可绕过 OCR 直接拿原图 |
| `cua_click(x, y, button, clicks)` | 左/右/中键，单击、双击、三击 |
| `cua_move(x, y)` | 只移动，用于悬停 |
| `cua_drag(from, to)` | 按住左键拖动 |
| `cua_scroll(x, y, down, right)` | 在某处转滚轮，单位是格 |
| `cua_type(text)` | 按 Unicode 字符打字，与键盘布局和输入法状态无关；`\n` 按回车 |
| `cua_key(keys)` | `"ctrl+s"`、`"alt+f4"`、`"ctrl+a delete"`：`+` 同时按，空格分先后 |
| `cua_windows` | 可见顶层窗口的标题、位置（截图坐标）、是否最小化、前台 |
| `cua_focus(window)` | 按句柄或标题片段切到前台，最小化的先还原 |
| `cua_wait(seconds)` | 等一会儿再截图 |

操作类工具默认做完等 `screenshot.settleMs`（500 ms）再附一张截图；参数 `screenshot: false` 可以省掉。

## 使用须知

- **每次操作前会先问你能不能动电脑**：弹窗 / 桌宠气泡问一句，你拒绝、关闭或 60 秒不回应，这一轮就不执行。
- **你一动鼠标键盘它就让位**：引擎会先确认你静止了 `userIdleMs`（默认 2 秒）才发输入；你中途动一下，它立刻停手并报告实际完成了多少。
- **敏感操作交还给你**：登录、密码、验证码、支付，以及发送 / 删除 / 提交 / 购买前，都会先问你。这些写在环境提示词 `src/ENV_PROMPT.md` 里。

## 常见问题 / 排错

**Q：怎么确认真的在省 token？**
A：对比改造前后的费用明细，重点看 **image token 数量** 和 **cache 命中率**；或观察一段任务后 `cua_screenshot` 返回的是不是文字而非图片。

**Q：屏幕上有字但 Coo 说"看不清" / 走了传图？**
A：通常是 OCR 没识别到。检查：
- **Windows**：是否装了对应语言的 OCR 语言包（设置 → 时间和语言 → 语言 → 中文(中华人民共和国) → 选项 → 下载"光学字符识别"）；或在 `vision.ocrLang` 显式填 `zh-Hans`。
- **macOS**：需安装 `tesseract`（`brew install tesseract tesseract-lang`），中文还要在 `vision.ocrLang` 里填 `chi_sim`（填 `zh-Hans` 会自动映射到 `chi_sim`），默认留空时只做英文；并在「系统设置 → 隐私与安全性」授予「录屏与系统录音」「辅助功能」权限。

**Q：macOS 上点不动 / 截不到图？**
A：给运行 Coopanion 的应用授予「录屏与系统录音」（截图、读窗口标题）和「辅助功能」（鼠标键盘）权限；首次使用系统会弹窗问。

**Q：想让它偶尔真的看原图？**
A：让 Coo 调用 `cua_screenshot({ forceImage: true })`，或在对话里说"发原图给我看"。

**Q：和原版 cua 比，行为有变化吗？**
A：除了"截图默认返回文字而非图片"外，鼠标 / 键盘 / 窗口 / 让位 / 权限等全部一致。`forceImage: true` 可随时回到原版行为。

## 预期节省（推算）

基于"截图是账单主因"这一前提（实测账单中未命中缓存的输入虽只占体积 8%，却占 73% 费用），本分支的节省：

- **视觉开销（截图 token + 缓存击穿）：约降 90%**。
- **整张账单：约降 55%–70%**（文字界面为主时更接近 70%；常做看图 / 视频类任务时接近 50%）。
- 额外红利：文字描述稳定 → 决策更准 → 减少"看不清反复重试"的浪费。

> 这是推算，最终以你 A/B 实测为准（见上「怎么确认真的在省 token」）。

## 开发者 / 测试（给贡献者）

- 拦截逻辑在 `src/local-vision.ts`（系统 OCR + 两级裁剪），编排在 `src/world.ts` 的 `screenshot()`；`vision.*` 配置在 `src/config.ts`；`cua_screenshot` 增加 `forceImage` 参数在 `src/tools.ts`。
- **不改动 koffi 引擎子进程**：OCR 与裁剪都在主进程用已依赖的 `jpeg-js` 完成，风险低、便于本地加载端到端验证。
- 校验与测试（仓库用 pnpm 管理，带 `pnpm-lock.yaml`；没有 pnpm 时用 `corepack pnpm`）：
  ```bash
  corepack pnpm install            # 或已装 pnpm：pnpm install
  pnpm typecheck                   # = tsc --noEmit，类型检查
  pnpm test                        # 单元测试（含 dryMountWorld 干装载校验）
  pnpm test:e2e                    # 端到端：会真机移动鼠标、打字，谨慎运行
  # 只跑桌面 e2e：pnpm exec vitest run tests/e2e/desktop.test.ts --config vitest.e2e.config.ts
  ```
- 端到端测试打开一个置顶的 WinForms 窗口（`tests/e2e/target-form.ps1`），把关心的屏幕坐标和收到的输入打印出来，断言洋红色块出现在窗口自报位置、文本输入一致等。

## 许可

MIT。基于 [Phantivia/cortico-world-cua](https://github.com/Phantivia/cortico-world-cua)。
