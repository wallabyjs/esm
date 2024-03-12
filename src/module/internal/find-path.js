// Based on `Module._findPath()`.
// Copyright Node.js contributors. Released under MIT license:
// https://github.com/nodejs/node/blob/master/lib/internal/modules/cjs/loader.js

import {
  basename,
  dirname,
  resolve,
  sep,
  join
} from "../../safe/path.js"

import CHAR_CODE from "../../constant/char-code.js"
import ENV from "../../constant/env.js"

import GenericArray from "../../generic/array.js"
import Module from "../../module.js"
import { Stats, existsSync } from "../../safe/fs.js"

import { emitWarning } from "../../safe/process.js"
import errors from "../../errors.js"
import inspectTrunc from "../../util/inspect-trunc.js"
import isAbsolute from "../../path/is-absolute.js"
import isExtJS from "../../path/is-ext-js.js"
import isExtMJS from "../../path/is-ext-mjs.js"
import isSep from "../../path/is-sep.js"
import keys from "../../util/keys.js"
import readPackage from "./read-package.js"
import realpath from "../../fs/realpath.js"
import shared from "../../shared.js"
import statFast from "../../fs/stat-fast.js"
import statSync from "../../fs/stat-sync.js"
import toStringLiteral from "../../util/to-string-literal.js"

const {
  APOSTROPHE,
  DOT
} = CHAR_CODE

const {
  FLAGS,
  TINK,
  YARN_PNP
} = ENV

const {
  MAIN_NOT_FOUND
} = errors

const { isFile } = Stats.prototype
const mainFields = ["main"]

const preserveAllSymlinks =
  TINK ||
  YARN_PNP

const resolveSymlinks =
  ! preserveAllSymlinks &&
  ! FLAGS.preserveSymlinks

const resolveSymlinksMain =
  ! preserveAllSymlinks &&
  ! FLAGS.preserveSymlinksMain

function findPath(request, paths, isMain = false, fields, exts) {
  const pathsLength = paths.length

  let cacheKey =
    request + "\0" +
    (pathsLength === 1
      ? paths[0]
      : GenericArray.join(paths)
    ) + "\0"

  if (fields !== void 0) {
    cacheKey += fields.length === 1
      ? fields[0]
      : fields.join()
  }

  cacheKey += "\0"

  if (exts !== void 0) {
    cacheKey += exts.length === 1
      ? exts[0]
      : exts.join()
  }

  cacheKey += "\0"

  if (isMain) {
    cacheKey += "1"
  }

  const cache = shared.memoize.moduleInternalFindPath
  const cached = cache.get(cacheKey)

  if (cached !== void 0) {
    return cached
  }

  const useRealpath = isMain
    ? resolveSymlinksMain
    : resolveSymlinks

  const isAbs = isAbsolute(request)

  if (! isAbs &&
      pathsLength === 0) {
    return ""
  }

  const requestLength = request.length

  let trailingSlash = requestLength !== 0

  if (trailingSlash) {
    let code = request.charCodeAt(requestLength - 1)

    if (code === DOT) {
      code = request.charCodeAt(requestLength - 2)

      if (code === DOT) {
        code = request.charCodeAt(requestLength - 3)
      }
    }

    trailingSlash = isSep(code)
  }

  if (isAbs) {
    if (useRealpath) {
      paths = [dirname(request)]
      request = basename(request)
    } else {
      paths = [request]
    }
  }

  for (const curPath of paths) {
    if (! isAbs &&
        statFast(curPath) !== 1) {
      continue
    }

    let thePath = curPath

    if (useRealpath) {
      thePath = realpath(curPath)

      if (thePath === "") {
        continue
      }
    }

    if (isAbs) {
      if (useRealpath) {
        thePath += sep + request
      }
    } else {
      thePath = resolve(thePath, request)
    }

    let rc = -1
    let stat = null

    if (isExtJS(thePath) ||
        isExtMJS(thePath)) {
      stat = statSync(thePath)

      if (stat !== null) {
        rc = Reflect.apply(isFile, stat, []) ? 0 : 1
      }
    } else {
      rc = statFast(thePath)
    }

    let foundPath = ""

    if (! trailingSlash) {
      // If a file.
      if (rc === 0) {
        foundPath = useRealpath
          ? realpath(thePath)
          : thePath
      }

      if (foundPath === "") {
        if (exts === void 0) {
          exts = keys(Module._extensions)
        }

        foundPath = tryExtensions(thePath, exts, isMain)
      }
    }

    // If a directory.
    if (rc === 1 &&
        foundPath === "") {
      if (exts === void 0) {
        exts = keys(Module._extensions)
      }

      if (fields === void 0) {
        fields = mainFields
      }

      foundPath = tryPackage(request, thePath, fields, exts, isMain)
    }

    if (foundPath !== "") {
      cache.set(cacheKey, foundPath)

      return foundPath
    }
  }

  return ""
}

function tryExtensions(thePath, exts, isMain) {
  for (const ext of exts) {
    const foundPath = tryFilename(thePath + ext, isMain)

    if (foundPath !== "") {
      return foundPath
    }
  }

  return ""
}

function tryField(dirPath, fieldPath, exts, isMain) {
  if (typeof fieldPath !== "string") {
    return ""
  }

  const thePath = resolve(dirPath, fieldPath)

  let foundPath = tryFilename(thePath, isMain)

  if (foundPath === "") {
    foundPath = tryExtensions(thePath, exts, isMain)
  }

  if (foundPath === "") {
    foundPath = tryExtensions(thePath + sep + "index", exts, isMain)
  }

  return foundPath
}

function tryFilename(filename, isMain) {
  let rc = -1

  if (isExtJS(filename) ||
      isExtMJS(filename)) {
    let stat = statSync(filename)

    if (stat !== null) {
      rc = Reflect.apply(isFile, stat, []) ? 0 : 1
    }
  } else {
    rc = statFast(filename)
  }

  if (rc) {
    return ""
  }

  const useRealpath = isMain
    ? resolveSymlinksMain
    : resolveSymlinks

  return useRealpath
    ? realpath(filename)
    : filename
}

function tryPackage(request, dirPath, fields, exts, isMain) {
  const json = readPackage(dirPath, fields)

  if (json === null) {
    return tryExtensions(dirPath + sep + "index", exts, isMain)
  }

  let field
  let fieldValue
  let foundPath

  for (field of fields) {
    fieldValue = json[field]
    foundPath = tryField(dirPath, fieldValue, exts, isMain)

    if (foundPath !== "" &&
        (field === "main" ||
         ! isExtMJS(foundPath))) {
      return foundPath
    }
  }

  // ! This is a very simplified implementation of finding the correct
  // ! CJS entry point. It does not support the `exports` field full
  // ! functionality; added to address JSDOM issue
  // ! https://github.com/wallabyjs/quokka/issues/928
  if (json.exports) {
    foundPath = resolveExports(json.exports, dirPath, request.substring(dirPath.length + 1))
    if (foundPath !== "" && ! isExtMJS(foundPath)) {
      return foundPath
    }
  }

  const jsonPath = dirPath + sep + "package.json"

  foundPath = tryExtensions(dirPath + sep + "index", exts, isMain)

  if (foundPath === "") {
    throw new MAIN_NOT_FOUND(request, jsonPath)
  }

  if (FLAGS.pendingDeprecation) {
    emitWarning(
      "Invalid " + toStringLiteral(field, APOSTROPHE) + " field in " +
      toStringLiteral(jsonPath, APOSTROPHE) + " of " + inspectTrunc(fieldValue) +
      ". Please either fix or report it to the module author",
      "DeprecationWarning",
      "DEP0128"
    )
  }

  return foundPath
}

function resolveExports(
  exports,
  packagePath,
  subpath
) {
  if (typeof exports === "string") {
    return join(packagePath, exports)
  }

  if (Array.isArray(exports)) {
    const availableExport = exports.find((exportPath) =>
      existsSync(join(packagePath, exportPath))
    )
    if (availableExport) {
      return join(packagePath, availableExport)
    }
    return null
  }

  if (exports.require) {
    return resolveExports(exports.require, packagePath, subpath)
  }

  if (exports.node) {
    return resolveExports(exports.node, packagePath, subpath)
  }

  if (exports.default) {
    return resolveExports(exports.default, packagePath, subpath)
  }

  if (exports["."] && !subpath) {
    return resolveExports(exports["."], packagePath, subpath)
  }

  const wellKnownConditions = ["import", "require", "node", "default", "."]
  const conditions = Object.keys(exports)
    .filter((condition) => !wellKnownConditions.includes(condition))
    .map((condition) => {
      const [startsWith, endsWith] = condition.split("*")
      return { endsWith, exports: exports[condition], startsWith }
    })

  if (subpath) {
     // Ensure the subpath format is correct
    const normalizedSubpath = `./${subpath}`

    const matchedCondition = conditions.find(
      ({ startsWith, endsWith }) =>
        normalizedSubpath.startsWith(startsWith) &&
        (!endsWith || normalizedSubpath.endsWith(endsWith))
    )
    if (matchedCondition) {
      if (matchedCondition.endsWith && typeof matchedCondition.exports === "string") {
        const pathToReplace = normalizedSubpath.substring(matchedCondition.startsWith.length, normalizedSubpath.length - matchedCondition.endsWith.length)
        return join(packagePath, matchedCondition.exports.replace("*", pathToReplace))
      }
      return resolveExports(matchedCondition.exports, packagePath, subpath)
    }
  }

  return null
}

export default findPath
