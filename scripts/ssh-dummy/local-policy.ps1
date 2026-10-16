# Optional extension for the existing dummy.ps1. Synthetic CPL only.
# Dot-source this file before the command loop, then call:
# if (Invoke-DummyLocalPolicyCommand $command) { continue }
# Insert that call after command.Trim() and before the existing command handlers.
# It uses the existing $script:Privileged / $script:ConfigMode flags.
# Set PROXYTOOLS_DUMMY_CPL_PATH to isolate a fixture; otherwise all sessions share one local dummy appliance.

function Get-DummyLocalPolicyPath {
    if ($env:PROXYTOOLS_DUMMY_CPL_PATH) { return $env:PROXYTOOLS_DUMMY_CPL_PATH }
    return (Join-Path ([IO.Path]::GetTempPath()) 'proxytools-dummy-local-policy.cpl')
}

function Invoke-DummyLocalPolicyCommand {
    param([string]$Command)
    $isRead = $Command -eq 'show sources policy local'
    $isInline = $Command -match '^inline policy local ([A-Za-z0-9_]+)$'
    if (-not $isRead -and -not $isInline) { return $false }
    if (-not $script:Privileged -or -not $script:ConfigMode) {
        [Console]::WriteLine('Error: privileged configuration mode required.')
        return $true
    }
    $path = Get-DummyLocalPolicyPath
    $utf8 = New-Object Text.UTF8Encoding($false)
    if (-not [IO.File]::Exists($path)) {
        [IO.File]::WriteAllText($path, "; Synthetic fixture only`n<Proxy>`nurl.domain=example.test allow`n", $utf8)
    }
    if ($isRead) {
        [Console]::Write([IO.File]::ReadAllText($path, $utf8))
        return $true
    }
    $delimiter = $Matches[1]
    $lines = New-Object 'System.Collections.Generic.List[string]'
    [Console]::WriteLine("Enter CPL; finish with $delimiter on its own line.")
    while ($true) {
        $line = [Console]::ReadLine()
        if ($null -eq $line) {
            [Console]::WriteLine('Error: incomplete inline policy; original retained.')
            return $true
        }
        if ($line -ceq $delimiter) { break }
        # Preserve leading spaces, blank lines and the order of all rules.
        $lines.Add($line)
    }
    $source = [string]::Join("`n", $lines) + "`n"
    if ([string]::IsNullOrWhiteSpace($source) -or $source.Contains('DUMMY_COMPILE_ERROR')) {
        [Console]::WriteLine('Error: dummy compiler rejected CPL; original retained.')
        return $true
    }
    [IO.File]::WriteAllText($path, $source, $utf8)
    [Console]::WriteLine('  ok')
    return $true
}
