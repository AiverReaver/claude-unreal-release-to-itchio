import { atom, read, update } from 'claude-code'
import type { Register, EngineInterface } from 'claude-code'

import type { ReleaseStatus } from '../types'

const USAGE = [
  'Usage: /ue-release <dev|release|other> [extra flags]',
  '  dev      Development build, pushed to the dev channel (windows-dev)',
  '  release  Shipping build, pushed to the release channel (windows)',
  '  other    Development build to the windows-other channel; pass -Config DebugGame, -Channel x',
  '  add -SkipBuild to push the last build again, -NoPush to only build',
  '',
  '/ue-release status                  show what is set up',
  '/ue-release setup engine <folder>   Unreal Engine folder (the one holding Engine\\)',
  '/ue-release setup itch <user/game>  itch.io page to push to',
  '/ue-release setup butler            download butler from itch.io',
  '/ue-release setup login             open a butler login window',
].join('\n')

const PROFILES = ['dev', 'release', 'other']

// Buttons above the prompt: label, profile, extra flags.
const BUTTONS = [
  { key: 'dev', label: 'Dev: build + push', profile: 'dev', flags: [] as string[] },
  { key: 'release', label: 'Release: build + push', profile: 'release', flags: [] as string[] },
  { key: 'push', label: 'Dev: push last build', profile: 'dev', flags: ['-SkipBuild'] },
  { key: 'other', label: 'Build only', profile: 'other', flags: ['-NoPush'] },
]

const MISSING_TEXT: Record<string, string> = {
  engine: 'Unreal Engine not found',
  butler: 'butler (the itch.io uploader) not installed',
  login: 'butler not logged in to itch.io',
  itch: 'no itch.io page set',
}

const running = atom({ plugin: 'unreal-release', key: 'running' } as const, null)
const status = atom({ plugin: 'unreal-release', key: 'status' } as const, null)
const note = atom({ plugin: 'unreal-release', key: 'note' } as const, null)

function scriptArgv($: EngineInterface, cwd: string, args: string[]): string[] {
  return [
    'powershell', '-NoProfile', '-ExecutionPolicy', 'Bypass',
    '-File', `${$.plugin.root}/scripts/ue-release.ps1`, '-ProjectDir', cwd, ...args,
  ]
}

async function hasUproject($: EngineInterface): Promise<boolean> {
  const entries = await $.fs.list(await $.session.cwd())
  return entries.some(one => one.name.endsWith('.uproject'))
}

// Runs one short script action and returns its last output line.
async function runAction($: EngineInterface, args: string[]): Promise<{ ok: boolean; text: string }> {
  const cwd = await $.session.cwd()
  const result = await $.process.run(scriptArgv($, cwd, args), { cwd, timeoutMs: 300_000 })
  const lines = `${result.stdout}\n${result.stderr}`.trim().split(/\r?\n/).filter(Boolean)
  return { ok: result.exitCode === 0, text: lines[lines.length - 1] ?? `exit ${result.exitCode}` }
}

async function refresh($: EngineInterface): Promise<ReleaseStatus | null> {
  if (!(await hasUproject($))) {
    await update($, status, () => null)
    return null
  }

  const { ok, text } = await runAction($, ['-Action', 'check'])
  let next: ReleaseStatus
  try {
    if (!ok) throw new Error(text)
    const parsed = JSON.parse(text) as ReleaseStatus
    next = { ...parsed, missing: Array.isArray(parsed.missing) ? parsed.missing : [] }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    next = {
      project: '', engineAssociation: '', enginePath: null, butler: null,
      loggedIn: false, itchTarget: null, missing: [], error: message,
    }
  }
  await update($, status, () => next)
  return next
}

// Runs a setup action, then checks again, and keeps the result as the band's note.
async function setup($: EngineInterface, args: string[]): Promise<string> {
  const { text } = await runAction($, args)
  await refresh($)
  await update($, note, () => text)
  return text
}

function statusText(s: ReleaseStatus | null): string {
  if (!s) return 'No .uproject in this folder.'
  if (s.error) return `Check failed: ${s.error}`
  return [
    `Project:  ${s.project} (engine ${s.engineAssociation || 'source build'})`,
    `Engine:   ${s.enginePath ?? 'not found'}`,
    `butler:   ${s.butler ?? 'not installed'}${s.butler ? (s.loggedIn ? ', logged in' : ', not logged in') : ''}`,
    `itch.io:  ${s.itchTarget ?? 'not set'}`,
    s.missing.length ? `Missing:  ${s.missing.join(', ')}` : 'Ready.',
  ].join('\n')
}

async function start($: EngineInterface, profile: string, flags: string[]): Promise<string> {
  if (await read($, running)) return 'A release is already running.'

  const s = (await read($, status)) ?? (await refresh($))
  const isBuildOnly = flags.includes('-NoPush')
  const blocking = (s?.missing ?? []).filter(m => !(isBuildOnly && m !== 'engine'))
  if (!s || s.error || blocking.length) {
    return `Not set up yet: ${blocking.map(m => MISSING_TEXT[m] ?? m).join(', ') || s?.error || 'no project'}. See /ue-release status.`
  }

  const cwd = await $.session.cwd()
  const label = [profile, ...flags].join(' ')
  const argv = scriptArgv($, cwd, ['-Action', 'build', '-Profile', profile, ...flags])
  await update($, running, () => label)
  $.ui.status(`ue-release ${label}: building`)

  void (async () => {
    let tail = ''
    let code: number | null = null
    try {
      const run = $.process.spawn({ argv, cwd })
      for await (const { text } of run) {
        tail = (tail + text).slice(-1500)
        const last = text.trim().split('\n').pop()
        if (last) $.ui.status(`ue-release ${label}: ${last.slice(0, 80)}`)
      }
      code = (await run.result).code
    } finally {
      await update($, running, () => null)
      $.ui.status(undefined)
    }
    $.ui.toast(code === 0 ? `ue-release ${label}: done` : `ue-release ${label}: failed (exit ${code})`)
    await $.session.append({
      message: {
        type: 'user',
        content: [{ type: 'text', text: `ue-release ${label} ended with exit code ${code}.\n${tail}` }],
      },
    })
  })()

  return `Started: ${label}. A build takes several minutes; progress shows in the status line.`
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    if (await hasUproject($)) {
      await $.command.register({
        name: 'ue-release',
        description: 'Package the Unreal game and push it to itch.io (dev, release, other, status, setup)',
      })
      void refresh($)
    }

    return next(e)
  })

  on('command.run', { command: 'ue-release' }, async ($, e) => {
    const words = e.args.trim().split(/\s+/).filter(Boolean)
    const first = words[0]

    if (first === 'status') return { text: statusText(await refresh($)) }

    if (first === 'setup') {
      const what = words[1]
      const rest = words.slice(2).join(' ')
      if (what === 'engine' && rest) return { text: await setup($, ['-Action', 'set', '-Key', 'EnginePath', '-Value', rest]) }
      if (what === 'itch' && rest) return { text: await setup($, ['-Action', 'set', '-Key', 'ItchTarget', '-Value', rest]) }
      if (what === 'butler') return { text: await setup($, ['-Action', 'install-butler']) }
      if (what === 'login') return { text: await setup($, ['-Action', 'login']) }
      return { text: USAGE }
    }

    if (!first || !PROFILES.includes(first)) return { text: USAGE }

    return { text: await start($, first, words.slice(1)) }
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const s = await read($, status)
    if (!s || e.props.hasSurvey) return next(e)

    // The band is drawn on the terminal and desktop, whose tables both carry Input.
    const elements = $.ui.resolve(e)
    if (!('Input' in elements)) return next(e)
    const { Box, Button, Input, Link, Text } = elements
    const busy = await read($, running)
    const lastNote = await read($, note)

    if (busy) {
      return (
        <Box>
          <Text dimColor>Unreal release running: {busy}</Text>
        </Box>
      )
    }

    if (s.error) {
      return (
        <Box>
          <Text dimColor>Unreal release: {s.error} </Text>
          <Button key="recheck" label="Recheck" onPress={() => refresh($)} />
        </Box>
      )
    }

    if (s.missing.length === 0) {
      return (
        <Box>
          <Text dimColor>Unreal release ({s.itchTarget}): </Text>
          {BUTTONS.map(one => (
            <Button
              key={one.key}
              label={one.label}
              onPress={async () => {
                $.ui.toast(await start($, one.profile, one.flags))
              }}
            />
          ))}
        </Box>
      )
    }

    const missing = s.missing
    return (
      <Box flexDirection="column">
        <Text dimColor>
          Unreal release setup: {missing.map(m => MISSING_TEXT[m] ?? m).join(', ')}
        </Text>
        {missing.includes('engine') ? (
          <Input
            key="engine"
            label={`Unreal Engine ${s.engineAssociation} folder`}
            placeholder={`C:\\Program Files\\Epic Games\\UE_${s.engineAssociation || '5.x'}`}
            submitLabel="Save"
            onSubmit={value => setup($, ['-Action', 'set', '-Key', 'EnginePath', '-Value', value])}
          />
        ) : null}
        {missing.includes('itch') ? (
          <Input
            key="itch"
            label="itch.io page (user/game)"
            placeholder="your-name/your-game"
            submitLabel="Save"
            onSubmit={value => setup($, ['-Action', 'set', '-Key', 'ItchTarget', '-Value', value])}
          />
        ) : null}
        <Box>
          {missing.includes('butler') ? (
            <Button key="butler" label="Install butler" onPress={() => setup($, ['-Action', 'install-butler'])} />
          ) : null}
          {missing.includes('login') && !missing.includes('butler') ? (
            <Button key="login" label="Log in to itch.io" onPress={() => setup($, ['-Action', 'login'])} />
          ) : null}
          {!missing.includes('engine') ? (
            <Button
              key="build-only"
              label="Build only"
              onPress={async () => {
                $.ui.toast(await start($, 'other', ['-NoPush']))
              }}
            />
          ) : null}
          <Button key="recheck" label="Recheck" onPress={() => refresh($)} />
        </Box>
        {missing.includes('butler') ? (
          <Link href="https://itch.io/docs/butler/installing.html" label="About butler" />
        ) : null}
        {lastNote ? <Text dimColor>{lastNote}</Text> : null}
      </Box>
    )
  })
}
