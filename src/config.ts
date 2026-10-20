/** Config section `worlds.cua`, defaults and the console config group. */
import type { ConfigGroup } from 'cortico/core/config-schema.ts';
import type { WorldSection } from 'cortico/world.ts';

export const CUA_ID = 'cua';

export interface CuaConfigSection extends WorldSection {
  /** false: screenshots and the window list only; every input tool fails with that reason. */
  control: boolean;
  screenshot: {
    maxWidth: number;
    maxHeight: number;
    /** JPEG quality, 1–100. */
    quality: number;
    /** Input tools attach a screenshot unless the call says otherwise. */
    afterAction: boolean;
    /** Wait after an action before taking its screenshot. */
    settleMs: number;
  };
  /** Before sending input, the user must have left mouse and keyboard alone this long. */
  userIdleMs: number;
  /** How long an input tool waits for that before giving up. */
  maxYieldWaitMs: number;
  /** Pause between 16-character chunks while typing. */
  typeChunkDelayMs: number;
  /** 本地视觉拦截层:OCR 优先拦截高清大图,只有本地彻底失败时才借 Coopanion 已配好的 API 发图。 */
  vision: {
    /** 本地 OCR（系统内置,免模型）:把截图转成文字+坐标返回,不向云端传图。默认开。 */
    ocr: boolean;
    /** 本地 OCR 彻底失败时,是否借用 Coopanion 已配置的视觉 API 把截图发回去。默认开。 */
    fallback: boolean;
    /** 两级截图中局部裁剪相对"上次坐标"的归一化边距(0-0.5);越小越省 token。默认 0.2。 */
    cropPadding: number;
    /** OCR 语言:Windows 填 WinRT 码(如 zh-Hans),macOS 填 tesseract 码(如 chi_sim);留空=Windows 跟随系统、macOS 英文。 */
    ocrLang: string;
  };
}

export const CUA_DEFAULTS: CuaConfigSection = {
  enabled: false,
  control: true,
  screenshot: { maxWidth: 1280, maxHeight: 800, quality: 75, afterAction: true, settleMs: 500 },
  userIdleMs: 2000,
  maxYieldWaitMs: 15_000,
  typeChunkDelayMs: 20,
  vision: { ocr: true, fallback: true, cropPadding: 0.2, ocrLang: '' },
};

const K = `worlds.${CUA_ID}`;

export const CUA_CONFIG_GROUP: ConfigGroup = {
  id: `world:${CUA_ID}`,
  owner: `world:${CUA_ID}`,
  schema: {
    type: 'object',
    title: '电脑操作',
    properties: {
      [`${K}.control`]: { type: 'boolean', title: '允许操作鼠标键盘', description: '关掉后只能截图和列窗口。', 'x-hot': true },
      [`${K}.userIdleMs`]: { type: 'integer', title: '让位时长', minimum: 0, maximum: 30000, 'x-suffix': 'ms', description: '你动过鼠标或键盘后,要静止这么久才继续操作。', 'x-hot': true },
      [`${K}.maxYieldWaitMs`]: { type: 'integer', title: '让位最多等待', minimum: 0, maximum: 120000, 'x-suffix': 'ms', 'x-hot': true },
      [`${K}.screenshot.maxWidth`]: { type: 'integer', title: '截图最大宽', minimum: 320, maximum: 3840, 'x-suffix': 'px', 'x-hot': true },
      [`${K}.screenshot.maxHeight`]: { type: 'integer', title: '截图最大高', minimum: 240, maximum: 2160, 'x-suffix': 'px', 'x-hot': true },
      [`${K}.screenshot.quality`]: { type: 'integer', title: '截图质量', minimum: 30, maximum: 95, 'x-hot': true },
      [`${K}.screenshot.afterAction`]: { type: 'boolean', title: '操作后附截图', 'x-hot': true },
      [`${K}.screenshot.settleMs`]: { type: 'integer', title: '截图前等待', minimum: 0, maximum: 5000, 'x-suffix': 'ms', 'x-hot': true },
      [`${K}.vision.ocr`]: { type: 'boolean', title: '本地OCR拦截', 'x-hot': true, description: '用系统内置 OCR 把截图转成文字,不向云端传图,最省 token。' },
      [`${K}.vision.fallback`]: { type: 'boolean', title: '视觉兜底(借Coopanion)', 'x-hot': true, description: '本地 OCR 取不到文字时,借助你已配置的视觉 API 发回截图(两级截图);关闭则纯本地。' },
      [`${K}.vision.cropPadding`]: { type: 'number', title: '兜底裁剪边距', minimum: 0, maximum: 0.5, description: '局部裁剪相对上次坐标的归一化边距,越小越省 token。' },
      [`${K}.vision.ocrLang`]: { type: 'string', title: 'OCR语言', description: 'Windows 填 WinRT 码(如 zh-Hans),macOS 填 tesseract 码(如 chi_sim);留空时 Windows 跟随系统、macOS 用英文。' },
    },
  },
};
