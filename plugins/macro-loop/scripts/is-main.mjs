// Whether the module at `url` is the script node was started with. Compares real paths:
// through a symlink, argv[1] keeps the typed path while import.meta.url is the real file.
import { realpathSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

export function isMain(url) {
  if (!process.argv[1]) return false
  try {
    return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(url))
  } catch {
    return false
  }
}
