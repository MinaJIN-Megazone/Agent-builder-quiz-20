$ErrorActionPreference = "Stop"
$projectRef = "gtieuwysqtdxttnkmlhv"
$poolerHost = "aws-1-ap-southeast-2.pooler.supabase.com"
$projectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$secretFile = Join-Path $projectRoot "supabase/functions/.env"

function Read-SecretFromClipboard([string]$prompt) {
    [void](Read-Host -Prompt "$prompt (copy value to clipboard, then press Enter)")
    $value = Get-Clipboard -Raw
    return ([string]$value).Trim()
}

function Invoke-SupabaseCli([string[]]$cliArgs) {
    & npx --yes supabase @cliArgs
    $exitCode = $LASTEXITCODE
    if ($exitCode -ne 0) {
        throw "Supabase CLI failed during 'supabase $($cliArgs[0])' (exit code $exitCode). Review the CLI error printed immediately above."
    }
}

if (-not (Test-Path $secretFile)) {
    throw "Missing Edge Function settings file: $secretFile"
}

$accessToken = Read-SecretFromClipboard "Supabase Personal Access Token"
$accessToken = $accessToken.Trim()
Write-Host ("Access token check: sbp_ prefix={0}; characters={1}; contains whitespace={2}" -f $accessToken.StartsWith("sbp_"), $accessToken.Length, ($accessToken -match "\s"))
if (-not $accessToken.StartsWith("sbp_")) {
    throw "The first input must be a Supabase Personal Access Token beginning with 'sbp_'. Do not use the 'sb_publishable_' project key."
}

$databasePassword = Read-SecretFromClipboard "Supabase database password"
if ([string]::IsNullOrWhiteSpace($databasePassword)) {
    throw "Database password is required. No credentials were written to files."
}
$encodedDatabasePassword = [Uri]::EscapeDataString($databasePassword)
$databaseUrl = "postgresql://postgres.${projectRef}:${encodedDatabasePassword}@${poolerHost}:5432/postgres?sslmode=require"

$previousNodeUseSystemCa = $env:NODE_USE_SYSTEM_CA
try {
    $env:SUPABASE_ACCESS_TOKEN = $accessToken
    $env:NODE_USE_SYSTEM_CA = "1"
    Push-Location $projectRoot
    try {
        Invoke-SupabaseCli @("link", "--project-ref", $projectRef)
        Invoke-SupabaseCli @("db", "push", "--remote=$databaseUrl", "--yes")
        Invoke-SupabaseCli @("secrets", "set", "--env-file", $secretFile, "--yes")
        Invoke-SupabaseCli @("functions", "deploy", "start-quiz")
        Invoke-SupabaseCli @("functions", "deploy", "submit-quiz")
        Invoke-SupabaseCli @("functions", "deploy", "leaderboard")
    }
    finally {
        Pop-Location
    }
}
finally {
    Remove-Item Env:SUPABASE_ACCESS_TOKEN -ErrorAction SilentlyContinue
    if ($null -eq $previousNodeUseSystemCa) {
        Remove-Item Env:NODE_USE_SYSTEM_CA -ErrorAction SilentlyContinue
    }
    else {
        $env:NODE_USE_SYSTEM_CA = $previousNodeUseSystemCa
    }
    $accessToken = $null
    $databasePassword = $null
    $encodedDatabasePassword = $null
    $databaseUrl = $null
}

Write-Host "Supabase schema and Edge Functions deployed. Configure event_ends_at and pg_cron using SUPABASE_SETUP.md before opening the quiz."