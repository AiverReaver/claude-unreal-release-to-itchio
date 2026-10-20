# Build an Unreal Engine project for Win64 and push it to itch.io with butler.
# Run by the unreal-release Claude mod; it also works on its own from a shell.
#
# Settings are kept per project in <project>\Saved\ue-release.json (Saved is not
# committed in a normal Unreal .gitignore):
#   EnginePath      engine folder (the one holding Engine\). Found automatically when unset.
#   ItchTarget      itch.io "user/game".
#   DevChannel      butler channel for -Profile dev      (default windows-dev)
#   ReleaseChannel  butler channel for -Profile release  (default windows)
#   OtherChannel    butler channel for -Profile other    (default windows-other)
#   ArchiveDir      where builds go (default <project>\Saved\Releases)
#   SteamAppId      when set, written to steam_appid.txt next to the game exe
#
# Actions:
#   check           print what is found and what is missing, as one JSON line
#   set             -Key <setting> -Value <value>
#   install-butler  download butler from itch.io into %LOCALAPPDATA%\ue-release\butler
#   login           open a console window running `butler login`
#   build           -Profile dev|release|other [-Config X] [-Channel X] [-SkipBuild] [-NoPush]
#
# Examples:
#   .\ue-release.ps1 -ProjectDir C:\MyGame -Action check
#   .\ue-release.ps1 -ProjectDir C:\MyGame -Action set -Key ItchTarget -Value me/my-game
#   .\ue-release.ps1 -ProjectDir C:\MyGame -Action build -Profile dev
param(
    [Parameter(Mandatory = $true)] [string] $ProjectDir,
    [ValidateSet("check", "set", "install-butler", "login", "build")] [string] $Action = "check",
    [ValidateSet("dev", "release", "other")] [string] $Profile = "dev",
    [string] $Config,
    [string] $Channel,
    [string] $Key,
    [string] $Value,
    [switch] $SkipBuild,
    [switch] $NoPush
)

$ErrorActionPreference = "Stop"
# One plain line per failure, so the mod can show it as is.
trap { Write-Output "ERROR: $($_.Exception.Message)"; exit 1 }

$SettingKeys = @("EnginePath", "ItchTarget", "DevChannel", "ReleaseChannel", "OtherChannel", "ArchiveDir", "SteamAppId")
$ButlerHome = Join-Path $env:LOCALAPPDATA "ue-release\butler"
$ButlerUrl = "https://broth.itch.zone/butler/windows-amd64/LATEST/archive/default"

function Find-Project {
    $found = @(Get-ChildItem -Path $ProjectDir -Filter *.uproject -File -ErrorAction SilentlyContinue)
    if ($found.Count -eq 0) { throw "No .uproject file in $ProjectDir" }
    if ($found.Count -gt 1) { throw "More than one .uproject file in $ProjectDir" }
    return $found[0]
}

function Get-SettingsPath { return Join-Path $ProjectDir "Saved\ue-release.json" }

function Read-Settings {
    $settings = @{}
    $path = Get-SettingsPath
    if (Test-Path $path) {
        $json = Get-Content $path -Raw | ConvertFrom-Json
        foreach ($prop in $json.PSObject.Properties) { $settings[$prop.Name] = [string] $prop.Value }
    }
    return $settings
}

function Save-Settings($settings) {
    $path = Get-SettingsPath
    New-Item -ItemType Directory -Force -Path (Split-Path $path) | Out-Null
    $ordered = [ordered] @{}
    foreach ($name in $SettingKeys) { if ($settings[$name]) { $ordered[$name] = $settings[$name] } }
    ($ordered | ConvertTo-Json) | Set-Content -Path $path -Encoding UTF8
}

function Test-Engine($path) {
    return $path -and (Test-Path (Join-Path $path "Engine\Build\BatchFiles\RunUAT.bat"))
}

function Get-EngineAssociation($uproject) {
    $json = Get-Content $uproject.FullName -Raw | ConvertFrom-Json
    return [string] $json.EngineAssociation
}

function Find-Engine($uproject, $settings) {
    if (Test-Engine $settings["EnginePath"]) { return $settings["EnginePath"] }

    $assoc = Get-EngineAssociation $uproject
    $candidates = @()
    if ($assoc -match '^\d+\.\d+$') {
        # Launcher installs register themselves under HKLM; fall back to the launcher's default folder.
        foreach ($root in @("HKLM:\SOFTWARE\EpicGames\Unreal Engine", "HKLM:\SOFTWARE\WOW6432Node\EpicGames\Unreal Engine")) {
            $item = Get-ItemProperty -Path (Join-Path $root $assoc) -ErrorAction SilentlyContinue
            if ($item -and $item.InstalledDirectory) { $candidates += $item.InstalledDirectory }
        }
        $candidates += Join-Path $env:ProgramFiles "Epic Games\UE_$assoc"
    }
    elseif ($assoc) {
        # Source builds register a GUID under HKCU.
        $builds = Get-ItemProperty -Path "HKCU:\Software\Epic Games\Unreal Engine\Builds" -ErrorAction SilentlyContinue
        if ($builds -and $builds.$assoc) { $candidates += $builds.$assoc }
    }
    else {
        # No association: the project sits inside an engine source tree.
        $candidates += Split-Path $ProjectDir
    }

    foreach ($path in $candidates) { if (Test-Engine $path) { return (Resolve-Path $path).Path } }
    return $null
}

function Find-Butler {
    $cmd = Get-Command butler -ErrorAction SilentlyContinue
    if ($cmd) { return $cmd.Source }
    foreach ($path in @((Join-Path $ButlerHome "butler.exe"), (Join-Path $env:APPDATA "itch\apps\butler\butler.exe"))) {
        if (Test-Path $path) { return $path }
    }
    return $null
}

function Test-ButlerLogin {
    if ($env:BUTLER_API_KEY) { return $true }
    return (Test-Path (Join-Path $env:USERPROFILE ".config\itch\butler_creds")) -or
        (Test-Path (Join-Path $env:APPDATA "itch\butler_creds"))
}

function Get-Status {
    $uproject = Find-Project
    $settings = Read-Settings
    $engine = Find-Engine $uproject $settings
    $butler = Find-Butler
    $loggedIn = Test-ButlerLogin

    $missing = @()
    if (-not $engine) { $missing += "engine" }
    if (-not $butler) { $missing += "butler" }
    if (-not $loggedIn) { $missing += "login" }
    if (-not $settings["ItchTarget"]) { $missing += "itch" }

    return [ordered] @{
        project           = $uproject.BaseName
        engineAssociation = Get-EngineAssociation $uproject
        enginePath        = $engine
        butler            = $butler
        loggedIn          = $loggedIn
        itchTarget        = $settings["ItchTarget"]
        missing           = $missing
    }
}

switch ($Action) {
    "check" {
        Get-Status | ConvertTo-Json -Compress
        exit 0
    }

    "set" {
        if ($SettingKeys -notcontains $Key) { throw "Unknown setting '$Key'. Use one of: $($SettingKeys -join ', ')" }
        $Value = $Value.Trim().Trim('"')
        if ($Key -eq "EnginePath" -and $Value) {
            # Accept the engine folder itself or its Engine\ subfolder.
            if (-not (Test-Engine $Value) -and (Test-Engine (Split-Path $Value))) { $Value = Split-Path $Value }
            if (-not (Test-Engine $Value)) { throw "No Engine\Build\BatchFiles\RunUAT.bat under $Value" }
            $Value = (Resolve-Path $Value).Path
        }
        if ($Key -eq "ItchTarget" -and $Value -and $Value -notmatch '^[^/\s]+/[^/\s]+$') {
            throw "ItchTarget must look like user/game, got '$Value'"
        }
        $settings = Read-Settings
        $settings[$Key] = $Value
        Save-Settings $settings
        Write-Output "Saved $Key in $(Get-SettingsPath)"
        exit 0
    }

    "install-butler" {
        $zip = Join-Path $env:TEMP "ue-release-butler.zip"
        [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
        Write-Output "Downloading butler from $ButlerUrl"
        Invoke-WebRequest -Uri $ButlerUrl -OutFile $zip -UseBasicParsing
        New-Item -ItemType Directory -Force -Path $ButlerHome | Out-Null
        Expand-Archive -Path $zip -DestinationPath $ButlerHome -Force
        Remove-Item $zip -Force
        $exe = Join-Path $ButlerHome "butler.exe"
        & $exe -V
        if ($LASTEXITCODE -ne 0) { throw "butler did not run after install" }
        Write-Output "Installed butler at $exe"
        exit 0
    }

    "login" {
        $butler = Find-Butler
        if (-not $butler) { throw "butler is not installed" }
        # butler login opens a browser and waits for it, so give it a window of its own.
        Start-Process -FilePath $butler -ArgumentList "login"
        Write-Output "Opened a butler login window. Finish the sign-in in your browser."
        exit 0
    }

    "build" {
        $status = Get-Status
        $settings = Read-Settings
        $needed = @($status.missing | Where-Object { -not ($NoPush -and @("butler", "login", "itch") -contains $_) })
        if ($needed.Count -gt 0) { throw "Not set up yet, missing: $($needed -join ', '). Run -Action check." }

        switch ($Profile) {
            "dev"     { if (-not $Config) { $Config = "Development" }; if (-not $Channel) { $Channel = $settings["DevChannel"] };     if (-not $Channel) { $Channel = "windows-dev" } }
            "release" { if (-not $Config) { $Config = "Shipping" };    if (-not $Channel) { $Channel = $settings["ReleaseChannel"] }; if (-not $Channel) { $Channel = "windows" } }
            "other"   { if (-not $Config) { $Config = "Development" }; if (-not $Channel) { $Channel = $settings["OtherChannel"] };   if (-not $Channel) { $Channel = "windows-other" } }
        }

        $uproject = Find-Project
        $engine = $status.enginePath
        $archiveRoot = $settings["ArchiveDir"]
        if (-not $archiveRoot) { $archiveRoot = Join-Path $ProjectDir "Saved\Releases" }
        $profileDir = Join-Path $archiveRoot $Profile
        $buildDir = Join-Path $profileDir "Windows"

        if (-not $SkipBuild) {
            # -nocompileeditor: building the editor target fails while the editor is open
            # ("Unable to build while Live Coding is active"); the game target still builds.
            # -unrealexe: Blueprint projects with generated targets otherwise make UAT look
            # for Binaries\Win64\<Project>Editor.target, which does not exist, and crash.
            $runUat = Join-Path $engine "Engine\Build\BatchFiles\RunUAT.bat"
            $unrealExe = Join-Path $engine "Engine\Binaries\Win64\UnrealEditor-Cmd.exe"
            & $runUat BuildCookRun `
                "-project=$($uproject.FullName)" -platform=Win64 "-clientconfig=$Config" "-unrealexe=$unrealExe" `
                -build -nocompileeditor -cook -stage -pak -archive "-archivedirectory=$profileDir" -utf8output
            if ($LASTEXITCODE -ne 0) { throw "Build failed (exit $LASTEXITCODE). See the first error above or the UAT log in %APPDATA%\Unreal Engine\AutomationTool\Logs." }
        }

        if (-not (Test-Path $buildDir)) { throw "Build folder not found: $buildDir" }
        if ($settings["SteamAppId"]) {
            Set-Content -Path (Join-Path $buildDir "steam_appid.txt") -Value $settings["SteamAppId"] -NoNewline
        }

        if ($NoPush) {
            Write-Output "Built $Config ($Profile) at $buildDir. Not pushed."
            exit 0
        }

        $version = ""
        if (Get-Command git -ErrorAction SilentlyContinue) {
            try { $version = (git -C $ProjectDir rev-parse --short HEAD 2>$null) } catch { $version = "" }
        }
        if (-not $version) { $version = Get-Date -Format "yyyyMMdd-HHmm" }

        $target = "$($settings['ItchTarget']):$Channel"
        & $status.butler push $buildDir $target --userversion $version.Trim()
        if ($LASTEXITCODE -ne 0) { throw "butler push failed (exit $LASTEXITCODE)." }
        Write-Output "Pushed $($version.Trim()) ($Config) to $target"
        exit 0
    }
}
