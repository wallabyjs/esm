import CHAR_CODE from "../constant/char-code.js"

import isPath from "../util/is-path.js"
import parseJSON6 from "../util/parse-json6.js"
import readFile from "../fs/read-file.js"
import realProcess from "../real/process.js"
import { resolve } from "../safe/path.js"
import shared from "../shared.js"

const {
  APOSTROPHE,
  LEFT_CURLY_BRACKET,
  QUOTE
} = CHAR_CODE

function getOptions() {
  const { env } = shared

  if (Reflect.has(env, "options")) {
    return env.options
  }

  const processEnv = realProcess.env
  const ESM_OPTIONS = processEnv && processEnv.ESM_OPTIONS

  if (typeof ESM_OPTIONS !== "string") {
    return env.options = null
  }

  let options = ESM_OPTIONS.trim()

  if (isPath(options)) {
    options = readFile(resolve(options), "utf8")
  }

  if (! options) {
    return env.options = null
  }

  const code0 = options.charCodeAt(0)

  if (code0 === APOSTROPHE ||
      code0 === LEFT_CURLY_BRACKET ||
      code0 === QUOTE) {
    options = parseJSON6(options)
  }

  return env.options = options
}

export default getOptions
