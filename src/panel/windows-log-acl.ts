import { execFileSync } from "node:child_process";

// Node's POSIX permission bits do not restrict Windows access-control lists.
export function secureWindowsLogPath(path: string, created: boolean, directory = false): void {
  const script = `
$ErrorActionPreference = 'Stop'
$path = $env:POLTERGEIST_PANEL_LOG_PATH
$user = [System.Security.Principal.WindowsIdentity]::GetCurrent().User
if ($env:POLTERGEIST_PANEL_LOG_DIRECTORY -eq '1') {
  $acl = New-Object System.Security.AccessControl.DirectorySecurity
  $rule = New-Object System.Security.AccessControl.FileSystemAccessRule($user, 'FullControl', 'ContainerInherit,ObjectInherit', 'None', 'Allow')
} else {
  $acl = New-Object System.Security.AccessControl.FileSecurity
  $rule = New-Object System.Security.AccessControl.FileSystemAccessRule($user, 'FullControl', 'Allow')
}
$acl.SetOwner($user)
$acl.SetAccessRuleProtection($true, $false)
$acl.AddAccessRule($rule)
if ($env:POLTERGEIST_PANEL_LOG_DIRECTORY -eq '1') {
  # Apply the ACL atomically at creation, never expose a newly-created directory.
  [System.IO.Directory]::CreateDirectory($path, $acl) | Out-Null
}
$item = Get-Item -LiteralPath $path -Force
if ($item.Attributes -band [System.IO.FileAttributes]::ReparsePoint) { throw 'Panel logs must not use reparse points' }
if ($env:POLTERGEIST_PANEL_LOG_CREATED -eq '1') { Set-Acl -LiteralPath $path -AclObject $acl }
$actual = Get-Acl -LiteralPath $path
if (!$actual.AreAccessRulesProtected -or $actual.GetOwner([System.Security.Principal.SecurityIdentifier]) -ne $user) { throw 'Could not secure panel log ownership' }
foreach ($entry in $actual.GetAccessRules($true, $true, [System.Security.Principal.SecurityIdentifier])) {
  if ($entry.IdentityReference -ne $user -or $entry.AccessControlType -ne 'Allow') { throw 'Could not restrict panel log access' }
}
`;
  execFileSync(
    "powershell.exe",
    [
      "-NoProfile",
      "-NonInteractive",
      "-EncodedCommand",
      Buffer.from(script, "utf16le").toString("base64"),
    ],
    {
      env: {
        ...process.env,
        POLTERGEIST_PANEL_LOG_PATH: path,
        POLTERGEIST_PANEL_LOG_CREATED: created ? "1" : "0",
        POLTERGEIST_PANEL_LOG_DIRECTORY: directory ? "1" : "0",
      },
      stdio: "pipe",
      timeout: 15_000,
      windowsHide: true,
    },
  );
}
