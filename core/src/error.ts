export type Message = string | Error

export type PROLOAD_ERROR_CODE = 'ERR_PROLOAD_INVALID' | 'ERR_PROLOAD_NOT_FOUND'
export class ProloadError extends Error {
  code?: string
  constructor(
    opts: {
      message?: string
      code?: string
    } = {},
  ) {
    super(opts.message)
    this.name = 'ProloadError'
    this.code = opts.code || 'ERR_PROLOAD_INVALID'
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, this.constructor)
    }
  }
}
export function assert(
  bool?: boolean,
  message?: Message,
  code?: PROLOAD_ERROR_CODE,
) {
  if (bool) return
  if (message instanceof Error) throw message
  throw new ProloadError({ message, code })
}
