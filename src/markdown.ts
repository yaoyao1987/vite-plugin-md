import MarkdownIt from 'markdown-it'
import matter from 'gray-matter'
import { toArray } from '@antfu/utils'
import type { ResolvedOptions } from './types'

const scriptSetupRE = /<\s*script[^>]*\bsetup\b[^>]*>([\s\S]*)<\/script>/mg
const defineExposeRE = /defineExpose\s*\(/mg

function extractScriptSetup(html: string) {
  const scripts: string[] = []
  html = html.replace(scriptSetupRE, (_, script) => {
    scripts.push(script)
    return ''
  })

  return { html, scripts }
}

function extractCustomBlock(html: string, options: ResolvedOptions) {
  const blocks: string[] = []
  for (const tag of options.customSfcBlocks) {
    html = html.replace(new RegExp(`<${tag}[^>]*\\b[^>]*>[^<>]*<\\/${tag}>`, 'mg'), (code) => {
      blocks.push(code)
      return ''
    })
  }

  return { html, blocks }
}

export function createMarkdown(options: ResolvedOptions) {
  const isVue2 = options.vueVersion.startsWith('2.')

  const markdown = new MarkdownIt({
    html: true,
    linkify: true,
    typographer: true,
    ...options.markdownItOptions,
  })

  markdown.linkify.set({ fuzzyLink: false })

  options.markdownItUses.forEach((e) => {
    const [plugin, options] = toArray(e)

    markdown.use(plugin, options)
  })

  options.markdownItSetup(markdown)

  return (id: string, raw: string) => {
    const { wrapperClasses, wrapperComponent, transforms, headEnabled, frontmatterPreprocess } = options

    raw = raw.trimStart()

    if (transforms.before)
      raw = transforms.before(raw, id)

    const { content: md, data } = options.frontmatter
      ? matter(raw)
      : { content: raw, data: null }

    let html = markdown.render(md, { id })

    if (wrapperClasses)
      html = `<div class="${wrapperClasses}">${html}</div>`
    else
      html = `<div>${html}</div>`
    if (wrapperComponent)
      html = `<${wrapperComponent}${options.frontmatter ? ' :frontmatter="frontmatter"' : ''}>${html}</${wrapperComponent}>`
    if (transforms.after)
      html = transforms.after(html, id)

    if (options.escapeCodeTagInterpolation) {
      // escape curly brackets interpolation in <code>, #14
      html = html.replace(/<code(.*?)>/g, '<code$1 v-pre>')
    }

    const hoistScripts = extractScriptSetup(html)
    html = hoistScripts.html
    const customBlocks = extractCustomBlock(html, options)
    html = customBlocks.html

    const scriptLines: string[] = []
    let frontmatterExportsLines: string[] = []

    if (options.frontmatter) {
      const { head, frontmatter } = frontmatterPreprocess(data || {}, options)

      scriptLines.push(`const frontmatter = ${JSON.stringify(frontmatter)}`)

      frontmatterExportsLines = Object.entries(frontmatter).map(([key, value]) => `export const ${key} = ${JSON.stringify(value)}`)

      if (!isVue2 && options.exposeFrontmatter && !defineExposeRE.test(hoistScripts.scripts.join('')))
        scriptLines.push('defineExpose({ frontmatter })')

      if (!isVue2 && headEnabled && head) {
        scriptLines.push(`const head = ${JSON.stringify(head)}`)
        scriptLines.unshift('import { useHead } from "@vueuse/head"')
        scriptLines.push('useHead(head)')
      }
    }

    scriptLines.push(...hoistScripts.scripts)

    const scripts = isVue2
      ? `<script>\n${scriptLines.join('\n')}\n${frontmatterExportsLines.join('\n')}\nexport default { data() { return { frontmatter } } }\n</script>`
      : `<script setup>\n${scriptLines.join('\n')}\n</script>${frontmatterExportsLines.length ? `\n<script>\n${frontmatterExportsLines.join('\n')}\n</script>` : ''}`

    const sfc = `<template>${html}</template>\n${scripts}\n${customBlocks.blocks.join('\n')}\n`

    return sfc
  }
}
