import { registerHooks } from 'node:module'
import { readFileSync, readdirSync } from 'node:fs'
import ts from 'typescript'

// Load the shared game modules in Node, including the campaign's Vite glob.
registerHooks({
  load(url, context, nextLoad) {
    if (url.endsWith('/levels/par.json')) {
      return { format: 'module', shortCircuit: true, source: `export default ${readFileSync(new URL(url), 'utf8')}` }
    }
    if (!url.endsWith('.ts')) return nextLoad(url, context)
    let source = readFileSync(new URL(url), 'utf8')
    if (url.endsWith('/levels/index.ts')) {
      const paths = ['easy', 'normal', 'hard'].flatMap(folder =>
        readdirSync(new URL(`./${folder}/`, url)).filter(name => name.endsWith('.level.ts')).map(name => `./${folder}/${name}`),
      )
      const imports = paths.map((path, i) => `import * as level${i} from ${JSON.stringify(path)}`).join('\n')
      const modules = `{${paths.map((path, i) => `${JSON.stringify(path)}: level${i}`).join(',')}}`
      source = `${imports}\n${source.replace("import.meta.glob<Record<string, unknown>>('./*/*.level.ts', { eager: true })", modules)}`
    }
    return { format: 'module', shortCircuit: true, source: ts.transpileModule(source, {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
    }).outputText }
  },
  resolve(specifier, context, nextResolve) {
    try { return nextResolve(specifier, context) }
    catch (error) {
      if (!['ERR_MODULE_NOT_FOUND', 'ERR_UNSUPPORTED_DIR_IMPORT'].includes(error.code) || !specifier.startsWith('.') || /\.[a-z]+$/i.test(specifier)) throw error
      try { return nextResolve(`${specifier}.ts`, context) }
      catch { return nextResolve(`${specifier}/index.ts`, context) }
    }
  },
})
