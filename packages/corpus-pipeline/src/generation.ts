export const KIMI_MODEL = 'moonshotai/kimi-k3'
export const DEEPSEEK_FLASH_MODEL = 'deepseek-ai/deepseek-v4-flash-0731'
export const GLM_FLASH_MODEL = 'z-ai/glm-5.3-flash'
export const COACH_MODELS: readonly string[] = [KIMI_MODEL, DEEPSEEK_FLASH_MODEL, GLM_FLASH_MODEL]
export const DEFAULT_GENERATION_MODEL = KIMI_MODEL
export interface GenerationCapabilities { streaming: boolean }
export function generationCapabilities(model: string): GenerationCapabilities {
  return { streaming: model === KIMI_MODEL || model === DEEPSEEK_FLASH_MODEL }
}
export function generationParameters(model: string, options?: { thinking?: boolean; reasoning_effort?: 'low' | 'high' | 'max' }) {
  if (model === KIMI_MODEL) return { temperature: 1, reasoning_effort: options?.reasoning_effort ?? 'low' }
  if (model === DEEPSEEK_FLASH_MODEL) return { temperature: 0, chat_template_kwargs: options ?? { thinking: false } }
  if (model === GLM_FLASH_MODEL) return { temperature: 0.5, reasoning_effort: options?.reasoning_effort ?? 'low', chat_template_kwargs: { clear_thinking: true } }
  return { temperature: 0, ...(options ? { chat_template_kwargs: options } : {}) }
}
