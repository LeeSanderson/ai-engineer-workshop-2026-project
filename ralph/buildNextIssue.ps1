#!/usr/bin/env pwsh
# Pure-PowerShell port of ralph/once.sh.
# Reads local issues + recent git history, hands them to `claude` with the
# ralph prompt, and pretty-prints the stream-json output (replaces jq+format.jq).

$ErrorActionPreference = "Stop"

function Format-Trim {
    param([object]$Value, [int]$MaxLength)
    if ($null -eq $Value) { return "" }
    $s = if ($Value -is [string]) {
        $Value
    } else {
        $Value | ConvertTo-Json -Compress -Depth 100
    }
    if ($s.Length -gt $MaxLength) { return $s.Substring(0, $MaxLength) + "..." }
    return $s
}

function Format-StreamLine {
    param([string]$Line)
    if ([string]::IsNullOrWhiteSpace($Line)) { return }

    try {
        $evt = $Line | ConvertFrom-Json -Depth 100
    } catch {
        return
    }

    if ($evt.type -eq "system" -and $evt.subtype -eq "init") {
        $model = if ($evt.PSObject.Properties['model'] -and $evt.model) { $evt.model } else { "?" }
        "-- session start (model: $model) --"
        return
    }

    if ($evt.type -eq "assistant") {
        foreach ($block in @($evt.message.content)) {
            if ($block.type -eq "text") {
                "`n[claude] $($block.text)"
            } elseif ($block.type -eq "tool_use") {
                "[tool ] $($block.name)  $(Format-Trim $block.input 200)"
            }
        }
        return
    }

    if ($evt.type -eq "user") {
        foreach ($block in @($evt.message.content)) {
            if ($block.type -eq "tool_result") {
                $inner = if ($block.content -is [array]) {
                    $block.content[0].text
                } else {
                    $block.content
                }
                "[ ok  ] $(Format-Trim $inner 500)"
            }
        }
        return
    }

    if ($evt.type -eq "result") {
        $cost  = if ($null -ne $evt.total_cost_usd) { $evt.total_cost_usd } else { 0 }
        $turns = if ($null -ne $evt.num_turns)      { $evt.num_turns }      else { 0 }
        "-- done: $($evt.subtype) (`$$cost, $turns turns) --"
    }
}

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot  = Split-Path -Parent $scriptDir

$issuesDir  = Join-Path $repoRoot "issues"
$issueFiles = @()
if (Test-Path $issuesDir) {
    $issueFiles = Get-ChildItem -Path $issuesDir -Filter "*.md" -File
}
$issues = if ($issueFiles.Count -gt 0) {
    ($issueFiles | ForEach-Object { Get-Content -Raw -LiteralPath $_.FullName }) -join "`n"
} else {
    "No issues found"
}

$commits = try {
    (git log -n 5 --format="%H%n%ad%n%B---" --date=short) -join "`n"
} catch {
    "No commits found"
}
if ([string]::IsNullOrWhiteSpace($commits)) { $commits = "No commits found" }

$prompt = Get-Content -Raw -LiteralPath (Join-Path $scriptDir "prompt.md")

$claudeInput = @"
Previous commits: $commits

Issues: $issues

$prompt
"@

$claudeInput |
    claude --print --verbose --output-format stream-json --permission-mode auto |
    ForEach-Object { Format-StreamLine $_ }
