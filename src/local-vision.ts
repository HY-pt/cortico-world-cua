/**
 * 本地视觉（轻量拦截层）：在 cua 截屏后,优先用本机原生 OCR 把屏幕转成文字 + 坐标,
 * 从而把原本要发往云端的高清大图"拦截"下来 —— 桌宠只收到文字,几乎不耗 token。
 *
 * 设计要点（对齐 localvision 定位）：
 *  - 不依赖任何"视觉小模型",不下载权重;OCR 用系统内置(WinRT / tesseract)。
 *  - 仅在"本地 OCR 彻底失败"时,才把截图交回 Coopanion 已配置的 API（两级截图：先局部后全屏）。
 *  - cropJpeg 实现两级截图：围绕"上次坐标"做局部裁剪以节约 token,失败再退回全屏。
 *
 * 此模块由 cua 的主进程调用（截屏 JPEG 已在主进程里）,不改动 koffi 引擎子进程。
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { writeFile, readFile } from 'node:fs/promises';
import { tmpdir, platform } from 'node:os';
import { join } from 'node:path';
import jpeg from 'jpeg-js';

const exec = promisify(execFile);

export interface OcrWord {
  text: string;
  x: number; // 归一化 左上 x (0-1)
  y: number; // 归一化 左上 y (0-1)
  w: number; // 归一化 宽 (0-1)
  h: number; // 归一化 高 (0-1)
  line: number;
}

export interface OcrItem {
  text: string;
  /** 中心坐标（截图像素空间,与 cua 工具坐标一致） */
  cx: number;
  cy: number;
  /** 归一化中心坐标 (0-1) */
  nx: number;
  ny: number;
  line: number;
}

export interface OcrResult {
  words: OcrWord[];
  w: number; // 图像宽（像素）
  h: number; // 图像高（像素）
}

/** 解码 JPEG 拿到宽高（给 tesseract 归一化用）。 */
function jpegSize(bytes: Uint8Array): { w: number; h: number } {
  try {
    const img = jpeg.decode(bytes, { useTArray: true });
    return { w: img.width, h: img.height };
  } catch {
    return { w: 0, h: 0 };
  }
}

/**
 * 运行本机 OCR。返回归一化文字框与图像尺寸。
 * WinRT 优先使用 ocrLang（若给出）;否则跟随用户系统语言;再回退 en-US。
 * 任何异常（无语言包、无 tesseract 等）都返回空结果,交由调用方走视觉兜底。
 */
export async function runOcr(bytes: Uint8Array, ocrLang?: string): Promise<OcrResult> {
  if (platform() === 'win32') return ocrWinRt(bytes, ocrLang);
  return ocrTesseract(bytes);
}

async function ocrWinRt(bytes: Uint8Array, ocrLang?: string): Promise<OcrResult> {
  const b64 = Buffer.from(bytes).toString('base64');
  const b64File = join(tmpdir(), `cua-ocr-${Date.now()}.b64`);
  const outFile = join(tmpdir(), `cua-ocr-${Date.now()}.txt`);
  await writeFile(b64File, b64, 'utf8');
  const b = b64File.replace(/\\/g, '\\\\').replace(/'/g, "''");
  const o = outFile.replace(/\\/g, '\\\\').replace(/'/g, "''");
  const langExpr = ocrLang
    ? `$engine=[Windows.Media.Ocr.OcrEngine]::TryCreate("${ocrLang}"); if(-not $engine){ $engine=[Windows.Media.Ocr.OcrEngine]::TryCreateFromUserProfileLanguages() }`
    : `$engine=[Windows.Media.Ocr.OcrEngine]::TryCreateFromUserProfileLanguages(); if(-not $engine){ try { $engine=[Windows.Media.Ocr.OcrEngine]::TryCreate("en-US") } catch {} }`;
  const ps = [
    '$ErrorActionPreference="Stop"',
    'Add-Type -AssemblyName System.Drawing',
    `$bytes=[System.Convert]::FromBase64String((Get-Content -Raw '${b}'))`,
    '$ms=New-Object System.IO.MemoryStream(,$bytes)',
    '$bmp=New-Object System.Drawing.Bitmap($ms)',
    '$w=$bmp.Width; $h=$bmp.Height',
    'try { [Windows.Media.Ocr.OcrEngine, Windows.Media.Ocr, ContentType = WindowsRuntime] | Out-Null } catch {}',
    langExpr,
    '$lines=@(("{0} {1}" -f $w,$h))',
    'if($engine){',
    '  $stream=New-Object Windows.Storage.Streams.InMemoryRandomAccessStream',
    '  $dw=New-Object Windows.Storage.Streams.DataWriter($stream)',
    '  $dw.WriteBytes($bytes)',
    '  [void]$dw.StoreAsync(); [void]$dw.FlushAsync(); $stream.Seek(0)',
    '  $task=$engine.RecognizeAsync($stream)',
    '  [void]$task.AsTask().Wait()',
    '  $res=$task.GetResults()',
    '  $li=0',
    '  foreach($line in $res.Lines){ foreach($word in $line.Words){ $r=$word.BoundingRect; $lines += ("{0}|{1}|{2}|{3}|{4}|{5}" -f ($word.Text -replace \'"\',\' \'),[int]$r.X,[int]$r.Y,[int]$r.Width,[int]$r.Height,$li) }; $li++ }',
    '}',
    `$lines -join \`n | Out-File -Encoding ascii '${o}'`,
  ].join('\n');
  try {
    await exec('powershell', ['-NoProfile', '-Command', ps]);
    const txt = await readFile(outFile, 'utf8');
    const rows = txt.split('\n').map((s) => s.trim()).filter(Boolean);
    if (rows.length < 1) return { words: [], w: 0, h: 0 };
    const [W, H] = rows[0].split(' ').map(Number);
    if (!W || !H) return { words: [], w: 0, h: 0 };
    const words: OcrWord[] = [];
    for (let i = 1; i < rows.length; i++) {
      const p = rows[i].split('|');
      if (p.length < 6) continue;
      words.push({
        text: p[0],
        x: Number(p[1]) / W,
        y: Number(p[2]) / H,
        w: Number(p[3]) / W,
        h: Number(p[4]) / H,
        line: Number(p[5]) || 0,
      });
    }
    return { words, w: W, h: H };
  } catch {
    return { words: [], w: 0, h: 0 };
  } finally {
    try { await exec('cmd', ['/c', 'del', '/q', b64File, outFile]); } catch { /* ignore */ }
  }
}

async function ocrTesseract(bytes: Uint8Array): Promise<OcrResult> {
  const imgFile = join(tmpdir(), `cua-ocr-${Date.now()}.jpg`);
  const base = join(tmpdir(), `cua-ocr-${Date.now()}`);
  await writeFile(imgFile, Buffer.from(bytes));
  const { w: W, h: H } = jpegSize(bytes);
  try {
    await exec('tesseract', [imgFile, base, '-l', 'eng', 'tsv']);
  } catch {
    return { words: [], w: W, h: H };
  }
  const tsv = await readFile(`${base}.tsv`, 'utf8').catch(() => '');
  const words: OcrWord[] = [];
  for (const line of tsv.split('\n')) {
    const cols = line.split('\t');
    if (cols.length < 12) continue;
    if (cols[1] !== '5') continue; // 仅取 word 级
    const left = Number(cols[6]);
    const top = Number(cols[7]);
    const width = Number(cols[8]);
    const height = Number(cols[9]);
    const text = cols[11];
    if (!text || !W || !H) continue;
    words.push({ text, x: left / W, y: top / H, w: width / W, h: height / H, line: Number(cols[4]) || 0 });
  }
  return { words, w: W, h: H };
}

/** 把归一化文字框转成"截图像素 + 归一化"的中心坐标项（与 cua 工具坐标一致）。 */
export function toItems(words: OcrWord[], imgW: number, imgH: number): OcrItem[] {
  return words.map((wd) => ({
    text: wd.text,
    cx: Math.round((wd.x + wd.w / 2) * imgW),
    cy: Math.round((wd.y + wd.h / 2) * imgH),
    nx: wd.x + wd.w / 2,
    ny: wd.y + wd.h / 2,
    line: wd.line,
  }));
}

/** 拼成 token 友好的可读文本:先按行阅读顺序,再给关键文字 + 中心坐标（截图像素,可直接 cua_click）。 */
export function buildOcrText(items: OcrItem[]): string {
  if (!items.length) return '';
  const maxLine = Math.max(...items.map((it) => it.line));
  const lines: string[] = [];
  for (let l = 0; l <= maxLine; l++) {
    const lw = items.filter((it) => it.line === l).sort((a, b) => a.nx - b.nx).map((it) => it.text);
    if (lw.length) lines.push(lw.join(' '));
  }
  const reading = lines.join('\n');
  const located = items.map((it) => `- ${it.text} @ (${it.cx}, ${it.cy})`).join('\n');
  return `可见文字(阅读顺序):\n${reading}\n关键文字及中心坐标(截图像素,可直接 cua_click):\n${located}`;
}

/**
 * 两级截图第一级：围绕归一化点 (nx,ny) 扩展 padding（0-1,相对图像宽高）做局部裁剪,
 * 返回裁剪后的 JPEG。用于"视觉兜底"时先发局部小图以节约 token。
 * 裁剪太小或失败返回 null（调用方退回全屏）。
 */
export function cropJpeg(bytes: Uint8Array, nx: number, ny: number, padding: number): Uint8Array | null {
  try {
    const img = jpeg.decode(bytes, { useTArray: true });
    const W = img.width;
    const H = img.height;
    const padX = Math.max(padding, 0.05) * W;
    const padY = Math.max(padding, 0.05) * H;
    let x0 = Math.max(0, Math.round(nx * W - padX));
    let y0 = Math.max(0, Math.round(ny * H - padY));
    let x1 = Math.min(W, Math.round(nx * W + padX));
    let y1 = Math.min(H, Math.round(ny * H + padY));
    const cw = x1 - x0;
    const ch = y1 - y0;
    if (cw < 80 || ch < 80) return null;
    const src = img.data as Uint8Array;
    const out = new Uint8Array(cw * ch * 4);
    for (let y = 0; y < ch; y++) {
      const s = ((y0 + y) * W + x0) * 4;
      out.set(src.subarray(s, s + cw * 4), y * cw * 4);
    }
    return jpeg.encode({ data: out, width: cw, height: ch }, 75).data;
  } catch {
    return null;
  }
}
