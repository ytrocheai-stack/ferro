export const KIMI_MODEL = 'moonshotai/kimi-k3'
export const DEFAULT_GENERATION_MODEL = KIMI_MODEL
export function generationParameters(model: string, options?: { thinking?: boolean; reasoning_effort?: 'low' | 'high' | 'max' }) {
  if (model === KIMI_MODEL) return { temperature: 1, reasoning_effort: options?.reasoning_effort ?? 'low' }
  return { temperature: 0, ...(options ? { chat_template_kwargs: options } : {}) }
}
