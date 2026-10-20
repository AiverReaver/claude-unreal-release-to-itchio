# unreal-release

A Claude Code mod for Unreal Engine projects. It packages your game for Windows
and pushes it to [itch.io](https://itch.io) with
[butler](https://itch.io/docs/butler/), from buttons above the Claude prompt
or the `/ue-release` command.

It only turns on in a folder that holds a `.uproject` file.

## Install

At the prompt of a Claude Code terminal session:

```
/plugin install unreal-release --marketplace AiverReaver/claude-unreal-release-to-itchio
```

Answer `y` to add the marketplace, then pick the user scope so it works in all
your projects.

From a shell:

```
claude plugin install unreal-release --marketplace AiverReaver/claude-unreal-release-to-itchio
```

In the Claude desktop app, where `/plugin` does not run: click **+** next to
the prompt box, then **Plugins**, **Add marketplace** with
`AiverReaver/claude-unreal-release-to-itchio`, then **Add plugin**.

In the desktop app a new chat starts its Claude process only when you send the
first message, so the buttons and `/ue-release` appear after that.

## First run: setup

Open a session in your Unreal project. The row above the prompt shows what is
missing and lets you fix it there:

| Missing | What the mod does |
| --- | --- |
| Unreal Engine | Looks it up from the `.uproject` `EngineAssociation`: the Epic launcher's registry entry, then `C:\Program Files\Epic Games\UE_<version>`, or the registered source build. If none is found, it asks for the engine folder. |
| butler | **Install butler** downloads it from itch.io into `%LOCALAPPDATA%\ue-release\butler`. A butler already on `PATH` or installed by the itch app is used as is. |
| itch.io login | **Log in to itch.io** opens a window running `butler login`; finish in the browser, then press **Recheck**. |
| itch.io page | Asks for `user/game`, the page to push to. Create the page on itch.io first. |

The same steps as commands:

```
/ue-release status
/ue-release setup engine C:\Program Files\Epic Games\UE_5.4
/ue-release setup butler
/ue-release setup login
/ue-release setup itch your-name/your-game
```

Settings are saved per project in `<project>\Saved\ue-release.json`, which a
normal Unreal `.gitignore` already leaves out.

## Releasing

| Button / command | What it does |
| --- | --- |
| **Dev: build + push** / `/ue-release dev` | Development build, pushed to the `windows-dev` channel |
| **Release: build + push** / `/ue-release release` | Shipping build, pushed to the `windows` channel |
| **Dev: push last build** / `/ue-release dev -SkipBuild` | Pushes the last dev build again, no rebuild |
| **Build only** / `/ue-release other -NoPush` | Development build, nothing uploaded |

Extra flags: `-Config DebugGame`, `-Channel <name>`, `-SkipBuild`, `-NoPush`.
Progress shows in the status line; when the build ends, the result and the
last lines of output are added to the conversation.

Builds go to `<project>\Saved\Releases\<profile>\Windows`. The version pushed
is the project's git commit, or the date and time when it is not a git repo.

You can build with the Unreal editor open: the mod builds the game target
only, and skips the editor target that Live Coding locks.

## Optional settings

Add these to `Saved\ue-release.json`, or set them with the script:

| Key | Default | Meaning |
| --- | --- | --- |
| `EnginePath` | found automatically | Engine folder, the one holding `Engine\` |
| `ItchTarget` | none | itch.io `user/game` |
| `DevChannel` | `windows-dev` | butler channel for `dev` |
| `ReleaseChannel` | `windows` | butler channel for `release` |
| `OtherChannel` | `windows-other` | butler channel for `other` |
| `ArchiveDir` | `<project>\Saved\Releases` | Where builds go |
| `SteamAppId` | none | When set, written to `steam_appid.txt` next to the game exe |

## Without Claude

The script works on its own from PowerShell:

```
.\scripts\ue-release.ps1 -ProjectDir C:\MyGame -Action check
.\scripts\ue-release.ps1 -ProjectDir C:\MyGame -Action set -Key ItchTarget -Value me/my-game
.\scripts\ue-release.ps1 -ProjectDir C:\MyGame -Action build -Profile dev
```

## Limits

- Windows only, Win64 builds only.
- One `.uproject` per folder.
- Tested with Unreal Engine 5.8 on a Blueprint project. C++ projects are
  expected to work but are not tested yet.

## License

MIT
