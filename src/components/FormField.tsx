import type { InputHTMLAttributes, ReactNode, TextareaHTMLAttributes } from 'react'

export function FormField({ label, help, error, children }: { label: string; help?: string; error?: string; children: ReactNode }) {
  return (
    <label className="form-field">
      <span className="form-field__label">{label}</span>
      {children}
      {help && <span className="form-field__help">{help}</span>}
      {error && <span className="form-field__error" role="alert">{error}</span>}
    </label>
  )
}

export type FormInputProps = InputHTMLAttributes<HTMLInputElement>
export type FormTextareaProps = TextareaHTMLAttributes<HTMLTextAreaElement>
