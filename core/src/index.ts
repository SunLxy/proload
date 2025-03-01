import escalade from 'escalade'
import { join, dirname, extname, resolve } from 'path'
import deepmerge from 'deepmerge'
import { existsSync, readdir, readFile, stat } from 'fs'
import { promisify } from 'util'
import requireOrImport from './requireOrImport'
import { assert, ProloadError } from './error'
import { PluginType, LoadOptions, Config } from './interface'
export { ProloadError }
export * from './interface'

const toStats = promisify(stat)
const toRead = promisify(readdir)
const toReadFile = promisify(readFile)

let merge = deepmerge
const defaultExtensions = ['js', 'cjs', 'mjs']
const defaultFileNames = ['[name].config']

const validNames = (namespace: string) => {
  const extensionPlugins = load.plugins.filter((p) =>
    Array.isArray(p.extensions),
  )
  const fileNamePlugins = load.plugins.filter((p) => Array.isArray(p.fileNames))
  const validExtensions = [...defaultExtensions].concat(
    ...extensionPlugins.map((p) => p.extensions),
  )
  const validFileNames = [...defaultFileNames].concat(
    ...fileNamePlugins.map((p) => p.fileNames),
  )

  const result = validFileNames
    .map((fileName) => fileName.replace('[name]', namespace))
    .reduce((acc, fileName) => {
      return [...acc].concat(
        ...validExtensions.map(
          (ext) => `${fileName}${ext ? '.' + ext.replace(/^\./, '') : ''}`,
        ),
      )
    }, [])

  return result
}

/**
 * @param {any} val
 * @returns {val is Record<any, any>}
 */
const isObject = (val: unknown) =>
  val != null && typeof val === 'object' && Array.isArray(val) === false

const requireOrImportWithMiddleware = async (filePath: string) => {
  let registerPlugins = load.plugins.filter(
    (plugin) => typeof plugin.register !== 'undefined',
  )
  let transformPlugins = load.plugins.filter(
    (plugin) => typeof plugin.transform !== 'undefined',
  )
  return requireOrImport(filePath, { middleware: registerPlugins }).then(
    async (mdl: any) =>
      Promise.all(
        transformPlugins.map(async (plugin) => {
          return Promise.resolve(plugin.transform(mdl)).then((result) => {
            if (result) mdl = result
          })
        }),
      ).then(() => mdl),
  )
}

/**
 *
 * @param {string} namespace
 * @param {{ filePath: string, extension: string }} opts
 * @returns {Promise<{ filePath: string, value: string }>}
 */
async function resolveExtension(
  namespace: string,
  { filePath, extension }: { filePath: string; extension: string },
): Promise<{ filePath: string; value: string }> {
  let resolvedPath
  if (extension.startsWith('./') || extension.startsWith('../')) {
    if (extname(extension) === '') {
      resolvedPath = resolve(
        dirname(filePath),
        `${extension}${extname(filePath)}`,
      )
    }
    if (!existsSync(resolvedPath)) resolvedPath = null

    if (!resolvedPath) {
      resolvedPath = resolve(dirname(filePath), extension)
    }
    if (!existsSync(resolvedPath)) resolvedPath = null
  }
  if (!resolvedPath) {
    const pkg = require.resolve(extension, {
      cwd: dirname(filePath),
    } as any)
    const accepted = validNames(namespace)
    for (const config of accepted) {
      try {
        resolvedPath = `${pkg}/${config}`
        if (resolvedPath && existsSync(resolvedPath)) {
          break
        } else {
          resolvedPath = null
        }
      } catch (e) {}
    }
  }
  if (!resolvedPath) {
    resolvedPath = require.resolve(extension, { cwd: dirname(filePath) } as any)
  }
  if (!resolvedPath) return
  const value = await requireOrImportWithMiddleware(resolvedPath)

  return { filePath: resolvedPath, value }
}

async function resolveExtensions(
  namespace: string,
  { filePath, value: raw, context }: any,
  acc: any = {},
) {
  let value = typeof raw === 'function' ? await raw(context) : raw
  if (Array.isArray(value)) return value

  assert(
    isObject(value),
    `${namespace} configuration expects an "object" but encountered ${value}`,
  )
  acc = merge(acc, value)
  if (!('extends' in value)) return acc

  assert(
    Array.isArray(value.extends),
    `${namespace} "extends" must be an array`,
  )

  const configs = await Promise.all(
    value.extends.map((extension: any) =>
      resolveExtension(namespace, { filePath, extension }).then((config) =>
        resolveExtensions(namespace, { ...config, context }, acc),
      ),
    ),
  )

  for (const config of configs) {
    acc = merge(acc, config)
  }

  delete acc.extends

  return acc
}

/**
 *
 * @param {string} namespace
 * @param {import('../index').LoadOptions} opts
 */
async function resolveConfig(namespace: string, opts: LoadOptions = {}) {
  const accepted = validNames(namespace)
  const { context, accept } = opts
  const input = opts.cwd || process.cwd()

  let mustExist = true
  if (typeof opts.mustExist !== 'undefined') {
    mustExist = opts.mustExist
  }
  if (typeof opts.merge === 'function') {
    merge = opts.merge
  }

  let filePath: string
  if (typeof opts.filePath === 'string') {
    const absPath = opts.filePath.startsWith('.')
      ? resolve(opts.filePath, input)
      : opts.filePath
    if (existsSync(absPath)) {
      filePath = absPath
    }
  } else {
    filePath = (await escalade(input, async (dir, names) => {
      if (accept) {
        for (const n of names) {
          if (accept(n, { directory: dir }) === true) return n
        }
      }

      for (const n of accepted) {
        if (names.includes(n)) return n
      }

      if (names.includes('config')) {
        let d = join(dir, 'config')
        let _,
          stats = await toStats(d)
        let entries = []
        if (stats.isDirectory()) {
          entries = await toRead(d)
          for (const n of accepted) {
            if (entries.includes(n)) return join('config', n)
          }
        }
      }

      if (names.includes('package.json')) {
        let file = join(dir, 'package.json')
        let _,
          contents = await toReadFile(file).then((r) =>
            JSON.parse(r.toString()),
          )
        if (contents[namespace]) return 'package.json'
      }
    })) as string
  }

  if (mustExist) {
    assert(
      !!filePath,
      `Unable to resolve a ${namespace} configuration`,
      'ERR_PROLOAD_NOT_FOUND',
    )
  } else if (!filePath) {
    return
  }
  return filePath
}

/**
 *
 * @param {string} namespace
 * @param {import('../index').LoadOptions} opts
 */
async function load<T extends Record<any, any> = Record<any, any>>(
  namespace: string,
  opts: LoadOptions<T> = {},
): Promise<Config<T> | undefined> {
  const { context } = opts
  let mustExist = true
  if (typeof opts.mustExist !== 'undefined') {
    mustExist = opts.mustExist
  }
  const filePath = await resolveConfig(namespace, opts)
  if (mustExist) {
    assert(
      !!filePath,
      `Unable to resolve a ${namespace} configuration`,
      'ERR_PROLOAD_NOT_FOUND',
    )
  } else if (!filePath) {
    return
  }

  let rawValue = await requireOrImportWithMiddleware(filePath as string)
  if ((filePath as string).endsWith('package.json'))
    rawValue = rawValue[namespace]
  // Important: "empty" config files will be returned as `Module {}`
  // We should handle them here
  if (rawValue && !(rawValue instanceof Object)) {
    if (mustExist) {
      assert(
        true,
        `Resolved a ${namespace} configuration, but no configuration was exported`,
        'ERR_PROLOAD_NOT_FOUND',
      )
    } else {
      return
    }
  }
  const resolvedValue = await resolveExtensions(namespace, {
    filePath,
    value: rawValue,
    context,
  })

  return {
    filePath,
    raw: rawValue,
    value: resolvedValue,
  }
}

const defaultPlugins: PluginType[] = [
  {
    name: '@proload/extract-default',
    transform(mdl: any) {
      if (mdl.default && Object.keys(mdl).length === 1) {
        return mdl.default
      }

      return mdl
    },
  },
]
load.plugins = defaultPlugins
load.use = (plugins: PluginType[]) => {
  load.plugins = [...load.plugins, ...plugins]
}
export default load

export const proloadLoad = load

export { resolveConfig as resolve }
