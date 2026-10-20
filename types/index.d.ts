// What scripts/ue-release.ps1 -Action check reports, plus `error` when the check itself failed.
export type ReleaseStatus = {
  project: string
  engineAssociation: string
  enginePath: string | null
  butler: string | null
  loggedIn: boolean
  itchTarget: string | null
  missing: string[]
  error?: string
}

declare module 'claude-code' {
  interface PluginState {
    'unreal-release': {
      running: string | null
      status: ReleaseStatus | null
      note: string | null
    }
  }
}
