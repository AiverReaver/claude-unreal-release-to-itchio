import { expect, test } from 'claude-code/testing'

const BAND = {
  plugin: 'unreal-release',
  component: 'AbovePrompt',
  props: {
    hasSurvey: false,
    isWorking: false,
    maxRows: 20,
    bodyColumns: 100,
    scroll: { offset: 0, bodyRows: 19 },
    view: {},
  },
} as const

const READY = {
  project: 'MyGame',
  engineAssociation: '5.8',
  enginePath: 'C:\\UE_5.8',
  butler: 'C:\\butler\\butler.exe',
  loggedIn: true,
  itchTarget: 'me/my-game',
  missing: [],
}

// Stands for the engine: a folder holding a .uproject, and a script whose check prints `status`.
async function seed($: any, on: any, status: object) {
  on('command.register', () => ({ value: { command: 'ue-release' } }))
  on('session.cwd', () => ({ value: 'C:/MyGame' }))
  on('fs.list', () => ({ value: [{ name: 'MyGame.uproject', kind: 'file' }] }))
  on('process.run', () => ({
    value: { exitCode: 0, stdout: JSON.stringify(status), stderr: '', isStdoutTruncated: false, isStderrTruncated: false },
  }))
  on('session.start', (_: unknown, e: { cwd: string }) => ({ cwd: e.cwd }))
  await $.session.start({ cwd: 'C:/MyGame', surface: 'desktop', isInteractive: true })
  await $.command.run({ command: 'ue-release', args: 'status' })
}


test('a set-up project shows the release buttons', async ($, on) => {
  await seed($, on, READY)

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...BAND, surface })
    expect(await ui.find({ key: 'dev' })).toBeDefined()
    expect(await ui.find({ key: 'release' })).toBeDefined()
    expect((await ui.find({ type: 'Text', text: /me\/my-game/ }))?.text).toContain('me/my-game')
    await ui.unmount()
  }
})

test('a project missing setup asks for the engine folder and itch page', async ($, on) => {
  await seed(
    $, on,
    { ...READY, enginePath: null, itchTarget: null, butler: null, loggedIn: false, missing: ['engine', 'butler', 'login', 'itch'] },
  )

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...BAND, surface })
    expect(await ui.find({ key: 'engine' })).toBeDefined()
    expect(await ui.find({ key: 'itch' })).toBeDefined()
    expect(await ui.find({ key: 'butler' })).toBeDefined()
    expect(await ui.find({ key: 'dev' })).toBeUndefined()
    await ui.unmount()
  }
})

test('outside an Unreal project the band is left to the engine', async ($, on) => {
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)

    return <Text>engine</Text>
  })

  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  expect((await ui.find({ type: 'Text', text: /engine/ }))?.text).toBe('engine')
  await ui.unmount()
})
