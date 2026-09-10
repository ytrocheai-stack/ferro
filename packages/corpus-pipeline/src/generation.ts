export const KIMI_MODEL = 'moonshotai/kimi-k3'
export const DEEPSEEK_FLASH_MODEL = 'deepseek-ai/deepseek-v4-flash-0731'
export const COACH_MODELS: readonly string[] = [KIMI_MODEL, DEEPSEEK_FLASH_MODEL]
export const DEFAULT_GENERATION_MODEL = KIMI_MODEL
export function generationParameters(model: string, options?: { thinking?: boolean; reasoning_effort?: 'low' | 'high' | 'max' }) {
  if (model === KIMI_MODEL) return { temperature: 1, reasoning_effort: options?.reasoning_effort ?? 'low' }
  if (model === DEEPSEEK_FLASH_MODEL) return { temperature: 0, chat_template_kwargs: options ?? { thinking: false } }
  return { temperature: 0, ...(options ? { chat_template_kwargs: options } : {}) }
}
