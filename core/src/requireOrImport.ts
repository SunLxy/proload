import { pathToFileURL } from 'url'

export default async function requireOrImport(
  filePath: string,
  { middleware = [] }: any = {},
) {
  await Promise.all(middleware.map((plugin: any) => plugin.register(filePath)))

  return new Promise(async (resolve, reject) => {
    try {
      let mdl = require(filePath)
      resolve(mdl)
    } catch (e) {
      if (e.code === 'ERR_REQUIRE_ESM') {
        const fileUrl = pathToFileURL(filePath).toString()
        try {
          const mdl = await import(fileUrl)
          return resolve(mdl)
        } catch (e) {
          reject(e)
        }
      }
      reject(e)
    }
  })
}
