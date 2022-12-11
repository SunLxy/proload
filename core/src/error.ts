/**
 * @type import('./error').ProloadError
 */
export class ProloadError extends Error {
  code?: string
  constructor(opts: any = {}) {
    super(opts.message)
    this.name = 'ProloadError'
    this.code = opts.code || 'ERR_PROLOAD_INVALID'
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, this.constructor)
    }
  }
}

/**
 * @type import('./error.cjs').assert
 */
export function assert(bool?: any, message?: any, code?: any) {
  if (bool) return
  if (message instanceof Error) throw message
  throw new ProloadError({ message, code })
}
